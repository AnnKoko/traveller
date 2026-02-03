/**
 * Standalone demo endpoint - works without Supabase
 * For testing Overpass integration directly
 */

const { fetchPOIs, getAvailableCategories, OverpassError } = require('../../lib/overpass');
const { dedupePOIs } = require('../../lib/cache');

async function handleOsmImportDemo(req, res) {
  try {
    const {
      center,
      bbox: inputBbox,
      radius_km = 5,
      categories,
      limit = 100
    } = req.body;

    // Validate
    if (!categories || categories.length === 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'categories array is required'
      });
    }

    if (!center && !inputBbox) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Either center or bbox is required'
      });
    }

    const validCategories = getAvailableCategories();
    const invalid = categories.filter(c => !validCategories.includes(c));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Invalid categories: ${invalid.join(', ')}. Valid: ${validCategories.join(', ')}`
      });
    }

    console.log(`Fetching POIs: ${categories.join(', ')} near ${JSON.stringify(center || inputBbox)}`);

    // Fetch from Overpass
    const result = await fetchPOIs({
      center,
      bbox: inputBbox,
      radiusKm: radius_km,
      categories,
      limit: Math.min(limit, 300)
    });

    // Dedupe
    const pois = dedupePOIs(result.pois);

    console.log(`Found ${pois.length} POIs`);

    return res.json({
      pois,
      meta: {
        from_cache: false,
        count: pois.length,
        bbox: result.meta.bbox,
        categories,
        timestamp: result.meta.timestamp
      }
    });

  } catch (error) {
    console.error('OSM import error:', error);

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

    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
}

module.exports = { handleOsmImportDemo };
