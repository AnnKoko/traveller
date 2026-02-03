/**
 * OSM Import API Endpoint
 * POST /api/osm/import
 *
 * Request body:
 *   trip_id: string (UUID)
 *   bbox?: { south, west, north, east }
 *   center?: { lat, lng }
 *   radius_km?: number (default 5)
 *   categories: string[]
 *   limit?: number (default 100, max 300)
 *
 * Response:
 *   pois: POI[]
 *   meta: { from_cache, count, bbox, categories }
 */

const { createClient } = require('@supabase/supabase-js');
const { fetchPOIs, centerRadiusToBbox, getAvailableCategories, OverpassError } = require('../../lib/overpass');
const { POICache, dedupePOIs, generateCacheKey } = require('../../lib/cache');

// Initialize Supabase client (use service role for cache access)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const poiCache = new POICache(supabase);

/**
 * Validate request body
 */
function validateRequest(body) {
  const errors = [];

  // trip_id is required
  if (!body.trip_id) {
    errors.push('trip_id is required');
  }

  // Either bbox or center is required
  if (!body.bbox && !body.center) {
    errors.push('Either bbox or center is required');
  }

  if (body.bbox) {
    const { south, west, north, east } = body.bbox;
    if (typeof south !== 'number' || typeof west !== 'number' ||
        typeof north !== 'number' || typeof east !== 'number') {
      errors.push('bbox must have numeric south, west, north, east');
    }
    if (south >= north) {
      errors.push('bbox.south must be less than bbox.north');
    }
    if (Math.abs(north - south) > 1 || Math.abs(east - west) > 1) {
      errors.push('bbox too large (max 1 degree)');
    }
  }

  if (body.center) {
    if (typeof body.center.lat !== 'number' || typeof body.center.lng !== 'number') {
      errors.push('center must have numeric lat and lng');
    }
    if (body.center.lat < -90 || body.center.lat > 90) {
      errors.push('center.lat must be between -90 and 90');
    }
    if (body.center.lng < -180 || body.center.lng > 180) {
      errors.push('center.lng must be between -180 and 180');
    }
  }

  if (body.radius_km !== undefined) {
    if (typeof body.radius_km !== 'number' || body.radius_km <= 0 || body.radius_km > 50) {
      errors.push('radius_km must be between 0 and 50');
    }
  }

  // categories is required
  if (!body.categories || !Array.isArray(body.categories) || body.categories.length === 0) {
    errors.push('categories array is required and must not be empty');
  } else {
    const valid = getAvailableCategories();
    const invalid = body.categories.filter(c => !valid.includes(c));
    if (invalid.length > 0) {
      errors.push(`Invalid categories: ${invalid.join(', ')}. Valid: ${valid.join(', ')}`);
    }
  }

  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || body.limit < 1 || body.limit > 300) {
      errors.push('limit must be between 1 and 300');
    }
  }

  return errors;
}

/**
 * Verify trip ownership
 */
async function verifyTripOwnership(tripId, userId) {
  const { data, error } = await supabase
    .from('trips')
    .select('id')
    .eq('id', tripId)
    .eq('user_id', userId)
    .single();

  return !error && data;
}

/**
 * Express route handler for OSM import
 */
async function handleOsmImport(req, res) {
  try {
    // Extract user from auth (assuming middleware sets req.user)
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Please log in to continue'
      });
    }

    // Validate request
    const errors = validateRequest(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        messages: errors
      });
    }

    const {
      trip_id,
      bbox: inputBbox,
      center,
      radius_km = 5,
      categories,
      limit = 100
    } = req.body;

    // Verify trip ownership
    const hasAccess = await verifyTripOwnership(trip_id, userId);
    if (!hasAccess) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Trip not found'
      });
    }

    // Calculate effective bbox
    const bbox = inputBbox || centerRadiusToBbox(center.lat, center.lng, radius_km);
    const effectiveLimit = Math.min(limit, 300);

    // Check cache first
    const cacheResult = await poiCache.get(bbox, categories);

    if (cacheResult.hit) {
      // Cache hit - return cached data
      const pois = dedupePOIs(cacheResult.pois).slice(0, effectiveLimit);
      return res.json({
        pois,
        meta: {
          from_cache: true,
          count: pois.length,
          bbox,
          categories,
          cache_key: cacheResult.cacheKey
        }
      });
    }

    // Check if fetch is in progress (cache stampede)
    if (cacheResult.inProgress) {
      // Wait a bit and check cache again
      await sleep(2000);
      const retryResult = await poiCache.get(bbox, categories);
      if (retryResult.hit) {
        const pois = dedupePOIs(retryResult.pois).slice(0, effectiveLimit);
        return res.json({
          pois,
          meta: {
            from_cache: true,
            count: pois.length,
            bbox,
            categories
          }
        });
      }
    }

    // Acquire lock
    const lockAcquired = await poiCache.acquireLock(cacheResult.cacheKey);
    if (!lockAcquired) {
      // Another request got the lock, wait and retry
      await sleep(3000);
      const retryResult = await poiCache.get(bbox, categories);
      if (retryResult.hit) {
        const pois = dedupePOIs(retryResult.pois).slice(0, effectiveLimit);
        return res.json({
          pois,
          meta: {
            from_cache: true,
            count: pois.length,
            bbox,
            categories
          }
        });
      }
    }

    // Fetch from Overpass
    let result;
    try {
      result = await fetchPOIs({
        bbox,
        categories,
        limit: 300 // Fetch max, cache all, return limited
      });
    } catch (error) {
      // Release lock on error
      await poiCache.releaseLock(cacheResult.cacheKey);

      if (error instanceof OverpassError) {
        const statusMap = {
          RATE_LIMITED: 429,
          TIMEOUT: 504,
          API_ERROR: 502
        };
        return res.status(statusMap[error.code] || 500).json({
          error: error.code,
          message: error.message
        });
      }
      throw error;
    }

    // Dedupe and cache
    const dedupedPois = dedupePOIs(result.pois);
    await poiCache.set(bbox, categories, dedupedPois);

    // Return limited results
    const pois = dedupedPois.slice(0, effectiveLimit);
    return res.json({
      pois,
      meta: {
        from_cache: false,
        count: pois.length,
        total_fetched: dedupedPois.length,
        bbox,
        categories,
        timestamp: result.meta.timestamp
      }
    });

  } catch (error) {
    console.error('OSM import error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to import POIs'
    });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { handleOsmImport, validateRequest };
