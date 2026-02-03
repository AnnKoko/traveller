/**
 * POI Cache Management
 * Handles caching of Overpass results with TTL and stampede prevention
 */

const crypto = require('crypto');

const CACHE_TTL_DAYS = 7;
const LOCK_TIMEOUT_MS = 30000; // 30 seconds max lock hold time

/**
 * Generate stable cache key from query parameters
 * Rounds bbox to 4 decimal places (~11m precision) for better cache hits
 */
function generateCacheKey(bbox, categories) {
  const sortedCategories = [...categories].sort();

  const keyData = {
    south: Math.round(bbox.south * 10000) / 10000,
    west: Math.round(bbox.west * 10000) / 10000,
    north: Math.round(bbox.north * 10000) / 10000,
    east: Math.round(bbox.east * 10000) / 10000,
    categories: sortedCategories.join(',')
  };

  const keyString = `bbox:${keyData.south},${keyData.west},${keyData.north},${keyData.east}|cats:${keyData.categories}`;
  return crypto.createHash('sha256').update(keyString).digest('hex');
}

/**
 * Cache class for POI data
 * Uses Supabase client for persistence
 */
class POICache {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Get cached POIs if available and not expired
   * @returns {{ pois: object[], hit: boolean, cacheKey: string }}
   */
  async get(bbox, categories) {
    const cacheKey = generateCacheKey(bbox, categories);

    const { data, error } = await this.supabase
      .from('poi_cache')
      .select('payload, expires_at, fetch_in_progress, fetch_started_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return { pois: null, hit: false, cacheKey };
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      return { pois: null, hit: false, cacheKey, expired: true };
    }

    // Check if fetch is in progress (cache stampede prevention)
    if (data.fetch_in_progress) {
      const lockAge = Date.now() - new Date(data.fetch_started_at).getTime();
      if (lockAge < LOCK_TIMEOUT_MS) {
        // Another request is fetching, wait and retry
        return { pois: null, hit: false, cacheKey, inProgress: true };
      }
      // Lock is stale, proceed to fetch
    }

    // Update hit count (fire and forget)
    this.supabase
      .from('poi_cache')
      .update({
        hit_count: data.hit_count + 1,
        last_hit_at: new Date().toISOString()
      })
      .eq('cache_key', cacheKey)
      .then(() => {});

    return {
      pois: data.payload,
      hit: true,
      cacheKey
    };
  }

  /**
   * Acquire lock for fetching (prevents cache stampede)
   * @returns {boolean} Whether lock was acquired
   */
  async acquireLock(cacheKey) {
    const now = new Date().toISOString();

    // Try to insert new row with lock
    const { error: insertError } = await this.supabase
      .from('poi_cache')
      .insert({
        cache_key: cacheKey,
        fetch_in_progress: true,
        fetch_started_at: now,
        categories: [],
        payload: [],
        poi_count: 0,
        expires_at: now // Will be updated on successful fetch
      });

    if (!insertError) {
      return true;
    }

    // Row exists, try to acquire lock via update
    const { data, error } = await this.supabase
      .from('poi_cache')
      .update({
        fetch_in_progress: true,
        fetch_started_at: now
      })
      .eq('cache_key', cacheKey)
      .or(`fetch_in_progress.eq.false,fetch_started_at.lt.${new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()}`)
      .select();

    return data && data.length > 0;
  }

  /**
   * Release lock (on error)
   */
  async releaseLock(cacheKey) {
    await this.supabase
      .from('poi_cache')
      .update({ fetch_in_progress: false })
      .eq('cache_key', cacheKey);
  }

  /**
   * Store POIs in cache
   */
  async set(bbox, categories, pois) {
    const cacheKey = generateCacheKey(bbox, categories);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const { error } = await this.supabase
      .from('poi_cache')
      .upsert({
        cache_key: cacheKey,
        bbox_south: bbox.south,
        bbox_west: bbox.west,
        bbox_north: bbox.north,
        bbox_east: bbox.east,
        categories: categories,
        poi_count: pois.length,
        payload: pois,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        fetch_in_progress: false,
        fetch_started_at: null,
        hit_count: 0
      }, {
        onConflict: 'cache_key'
      });

    if (error) {
      console.error('Cache set error:', error);
    }

    return !error;
  }
}

/**
 * Dedupe POIs by OSM ID (strict dedupe)
 * @param {object[]} pois - Array of POIs
 * @returns {object[]} Deduped POIs
 */
function dedupeByOsmId(pois) {
  const seen = new Set();
  const result = [];

  for (const poi of pois) {
    const key = `${poi.osm_type}:${poi.osm_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(poi);
    }
  }

  return result;
}

/**
 * Soft dedupe by name + proximity
 * Merges POIs with similar names within distance threshold
 * @param {object[]} pois - Array of POIs
 * @param {number} distanceThresholdMeters - Max distance for merge (default 50m)
 * @returns {object[]} Deduped POIs
 */
function dedupeByProximity(pois, distanceThresholdMeters = 50) {
  if (pois.length === 0) return pois;

  const result = [];
  const processed = new Set();

  for (let i = 0; i < pois.length; i++) {
    if (processed.has(i)) continue;

    const poi = pois[i];
    const normalizedName = normalizeName(poi.name);

    // Find similar POIs
    for (let j = i + 1; j < pois.length; j++) {
      if (processed.has(j)) continue;

      const other = pois[j];
      const otherNormalizedName = normalizeName(other.name);

      if (normalizedName === otherNormalizedName) {
        const distance = haversineDistance(poi.lat, poi.lng, other.lat, other.lng);
        if (distance <= distanceThresholdMeters) {
          // Mark as duplicate - keep the first one (node > way > relation priority)
          processed.add(j);
        }
      }
    }

    result.push(poi);
    processed.add(i);
  }

  return result;
}

/**
 * Normalize name for comparison
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Full dedupe pipeline
 */
function dedupePOIs(pois, options = {}) {
  const { softDedupe = true, distanceThreshold = 50 } = options;

  // Step 1: Strict dedupe by OSM ID
  let result = dedupeByOsmId(pois);

  // Step 2: Optional soft dedupe by proximity
  if (softDedupe) {
    result = dedupeByProximity(result, distanceThreshold);
  }

  return result;
}

module.exports = {
  POICache,
  generateCacheKey,
  dedupeByOsmId,
  dedupeByProximity,
  dedupePOIs,
  haversineDistance,
  CACHE_TTL_DAYS
};
