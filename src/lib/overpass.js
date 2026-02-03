/**
 * Overpass API Query Builder and Client
 * Fetches POIs from OpenStreetMap via Overpass API
 */

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'Traveller/1.0 (https://github.com/traveller-app; contact@traveller.app)';
const REQUEST_TIMEOUT = 25000; // 25 seconds
const MAX_RETRIES = 2;

/**
 * Category definitions mapping to OSM tags
 */
const CATEGORY_TAGS = {
  // Culture & Sightseeing
  museum: [{ key: 'tourism', value: 'museum' }],
  attraction: [{ key: 'tourism', value: 'attraction' }],
  viewpoint: [{ key: 'tourism', value: 'viewpoint' }],
  gallery: [{ key: 'tourism', value: 'gallery' }],
  historic: [{ key: 'historic', value: '*' }],
  religious: [{ key: 'amenity', value: 'place_of_worship' }],

  // Nature & Outdoors
  park: [{ key: 'leisure', value: 'park' }],
  beach: [{ key: 'natural', value: 'beach' }],
  nature_reserve: [{ key: 'leisure', value: 'nature_reserve' }],
  waterfall: [{ key: 'waterway', value: 'waterfall' }],
  peak: [{ key: 'natural', value: 'peak' }],
  cave: [{ key: 'natural', value: 'cave_entrance' }],

  // Extreme & Adventure Sports
  climbing: [
    { key: 'sport', value: 'climbing' },
    { key: 'climbing', value: '*' }
  ],
  diving: [
    { key: 'sport', value: 'scuba_diving' },
    { key: 'sport', value: 'diving' }
  ],
  surfing: [{ key: 'sport', value: 'surfing' }],
  kitesurfing: [{ key: 'sport', value: 'kitesurfing' }],
  paragliding: [
    { key: 'sport', value: 'paragliding' },
    { key: 'sport', value: 'hang_gliding' }
  ],
  skydiving: [{ key: 'sport', value: 'parachuting' }],
  bungee: [{ key: 'sport', value: 'bungee_jumping' }],
  rafting: [{ key: 'sport', value: 'rafting' }],
  kayak: [
    { key: 'sport', value: 'kayaking' },
    { key: 'sport', value: 'canoe' }
  ],
  skiing: [
    { key: 'sport', value: 'skiing' },
    { key: 'piste:type', value: '*' }
  ],
  mountain_biking: [{ key: 'sport', value: 'cycling' }],
  zip_line: [{ key: 'attraction', value: 'zip_line' }],

  // Food & Drink
  restaurant: [{ key: 'amenity', value: 'restaurant' }],
  cafe: [{ key: 'amenity', value: 'cafe' }],
  bar: [{ key: 'amenity', value: 'bar' }],
  market: [{ key: 'amenity', value: 'marketplace' }],

  // Entertainment
  theatre: [{ key: 'amenity', value: 'theatre' }],
  cinema: [{ key: 'amenity', value: 'cinema' }],
  zoo: [{ key: 'tourism', value: 'zoo' }],
  aquarium: [{ key: 'tourism', value: 'aquarium' }],
  theme_park: [{ key: 'tourism', value: 'theme_park' }],
  nightclub: [{ key: 'amenity', value: 'nightclub' }],

  // Sports & Recreation
  swimming: [
    { key: 'leisure', value: 'swimming_pool' },
    { key: 'sport', value: 'swimming' }
  ],
  stadium: [{ key: 'leisure', value: 'stadium' }],
  golf: [{ key: 'leisure', value: 'golf_course' }],

  // Accommodation
  hotel: [{ key: 'tourism', value: 'hotel' }],
  hostel: [{ key: 'tourism', value: 'hostel' }],
  camping: [{ key: 'tourism', value: 'camp_site' }]
};

/**
 * Get all available categories
 */
function getAvailableCategories() {
  return Object.keys(CATEGORY_TAGS);
}

/**
 * Validate categories array
 */
function validateCategories(categories) {
  const valid = getAvailableCategories();
  const invalid = categories.filter(c => !valid.includes(c));
  if (invalid.length > 0) {
    throw new Error(`Invalid categories: ${invalid.join(', ')}`);
  }
  return true;
}

/**
 * Convert center + radius to bounding box
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radiusKm - Radius in kilometers
 * @returns {{ south: number, west: number, north: number, east: number }}
 */
function centerRadiusToBbox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.0;
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));

  return {
    south: lat - latDelta,
    west: lng - lngDelta,
    north: lat + latDelta,
    east: lng + lngDelta
  };
}

/**
 * Build Overpass QL query for given bbox and categories
 * @param {{ south: number, west: number, north: number, east: number }} bbox
 * @param {string[]} categories
 * @param {number} limit - Max results (default 300)
 * @returns {string} Overpass QL query
 */
function buildOverpassQuery(bbox, categories, limit = 300) {
  validateCategories(categories);

  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  // Build tag filters for each category
  const tagFilters = [];
  for (const category of categories) {
    const tags = CATEGORY_TAGS[category];
    for (const tag of tags) {
      if (tag.value === '*') {
        // Wildcard: match any value for this key
        tagFilters.push(`["${tag.key}"]`);
      } else {
        tagFilters.push(`["${tag.key}"="${tag.value}"]`);
      }
    }
  }

  // Build query with union of all tag filters
  // Using out center for ways/relations to get centroid coordinates
  const query = `
[out:json][timeout:25][bbox:${bboxStr}];
(
  ${tagFilters.map(f => `node${f}["name"];`).join('\n  ')}
  ${tagFilters.map(f => `way${f}["name"];`).join('\n  ')}
  ${tagFilters.map(f => `relation${f}["name"];`).join('\n  ')}
);
out center tags ${limit};
`.trim();

  return query;
}

/**
 * Build Overpass QL query using "around" for center+radius
 * Alternative to bbox when more precise circular area is needed
 * @param {{ lat: number, lng: number }} center
 * @param {number} radiusMeters
 * @param {string[]} categories
 * @param {number} limit
 * @returns {string}
 */
function buildOverpassQueryAround(center, radiusMeters, categories, limit = 300) {
  validateCategories(categories);

  const tagFilters = [];
  for (const category of categories) {
    const tags = CATEGORY_TAGS[category];
    for (const tag of tags) {
      if (tag.value === '*') {
        tagFilters.push(`["${tag.key}"]`);
      } else {
        tagFilters.push(`["${tag.key}"="${tag.value}"]`);
      }
    }
  }

  const aroundStr = `around:${radiusMeters},${center.lat},${center.lng}`;

  const query = `
[out:json][timeout:25];
(
  ${tagFilters.map(f => `node${f}["name"](${aroundStr});`).join('\n  ')}
  ${tagFilters.map(f => `way${f}["name"](${aroundStr});`).join('\n  ')}
  ${tagFilters.map(f => `relation${f}["name"](${aroundStr});`).join('\n  ')}
);
out center tags ${limit};
`.trim();

  return query;
}

/**
 * Execute Overpass query with retry logic
 * @param {string} query - Overpass QL query
 * @returns {Promise<object>} Overpass response
 */
async function executeOverpassQuery(query) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 30;
        throw new OverpassError('RATE_LIMITED', `Rate limited. Retry after ${retryAfter}s`, 429);
      }

      if (response.status === 504 || response.status === 408) {
        throw new OverpassError('TIMEOUT', 'Query timed out. Try a smaller area.', 504);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new OverpassError('API_ERROR', `Overpass API error: ${text}`, response.status);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      lastError = error;

      if (error.name === 'AbortError') {
        lastError = new OverpassError('TIMEOUT', 'Request timed out', 504);
      }

      // Don't retry on rate limit or client errors
      if (error instanceof OverpassError && (error.code === 'RATE_LIMITED' || error.httpStatus < 500)) {
        throw error;
      }

      // Wait before retry (exponential backoff)
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Custom error class for Overpass errors
 */
class OverpassError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'OverpassError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Parse Overpass response and normalize to POI schema
 * @param {object} response - Overpass API response
 * @param {string[]} categories - Categories that were queried
 * @returns {object[]} Normalized POI array
 */
function normalizeOverpassResponse(response, categories) {
  if (!response.elements || !Array.isArray(response.elements)) {
    return [];
  }

  const pois = [];

  for (const element of response.elements) {
    const tags = element.tags || {};

    // Skip elements without name
    if (!tags.name) continue;

    // Get coordinates (use center for ways/relations)
    let lat, lng;
    if (element.type === 'node') {
      lat = element.lat;
      lng = element.lon;
    } else if (element.center) {
      lat = element.center.lat;
      lng = element.center.lon;
    } else {
      continue; // Skip if no coordinates available
    }

    // Determine category from tags
    const category = detectCategory(tags, categories);

    // Build normalized POI
    const poi = {
      osm_type: element.type,
      osm_id: element.id,
      name: tags.name,
      lat: parseFloat(lat.toFixed(7)),
      lng: parseFloat(lng.toFixed(7)),
      category: category,
      website: tags.website || tags['contact:website'] || null,
      phone: tags.phone || tags['contact:phone'] || null,
      opening_hours: tags.opening_hours || null,
      address: extractAddress(tags),
      raw_tags: tags,
      source: 'osm'
    };

    pois.push(poi);
  }

  return pois;
}

/**
 * Detect category from OSM tags
 */
function detectCategory(tags, requestedCategories) {
  for (const category of requestedCategories) {
    const categoryTags = CATEGORY_TAGS[category];
    for (const ct of categoryTags) {
      if (ct.value === '*') {
        if (tags[ct.key]) return category;
      } else {
        if (tags[ct.key] === ct.value) return category;
      }
    }
  }
  return requestedCategories[0] || 'attraction';
}

/**
 * Extract address from OSM tags
 */
function extractAddress(tags) {
  const hasAddress = tags['addr:street'] || tags['addr:city'] || tags['addr:country'];
  if (!hasAddress) return null;

  return {
    street: tags['addr:street'] || null,
    housenumber: tags['addr:housenumber'] || null,
    city: tags['addr:city'] || null,
    postcode: tags['addr:postcode'] || null,
    country: tags['addr:country'] || null
  };
}

/**
 * Helper: sleep for ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function: Fetch POIs from Overpass
 * @param {object} params
 * @param {object} [params.bbox] - { south, west, north, east }
 * @param {object} [params.center] - { lat, lng }
 * @param {number} [params.radiusKm] - Radius in km (if using center)
 * @param {string[]} params.categories - Category keys
 * @param {number} [params.limit] - Max POIs (default 100, max 300)
 * @returns {Promise<{ pois: object[], meta: object }>}
 */
async function fetchPOIs({ bbox, center, radiusKm = 5, categories, limit = 100 }) {
  // Validate inputs
  if (!categories || categories.length === 0) {
    throw new Error('At least one category is required');
  }

  // Enforce hard limit
  const effectiveLimit = Math.min(limit, 300);

  // Determine bbox
  let effectiveBbox;
  if (bbox) {
    effectiveBbox = bbox;
  } else if (center) {
    effectiveBbox = centerRadiusToBbox(center.lat, center.lng, radiusKm);
  } else {
    throw new Error('Either bbox or center+radiusKm is required');
  }

  // Build and execute query
  const query = buildOverpassQuery(effectiveBbox, categories, effectiveLimit);
  const response = await executeOverpassQuery(query);

  // Normalize response
  const pois = normalizeOverpassResponse(response, categories);

  return {
    pois,
    meta: {
      count: pois.length,
      bbox: effectiveBbox,
      categories,
      timestamp: new Date().toISOString()
    }
  };
}

module.exports = {
  fetchPOIs,
  buildOverpassQuery,
  buildOverpassQueryAround,
  normalizeOverpassResponse,
  centerRadiusToBbox,
  getAvailableCategories,
  validateCategories,
  CATEGORY_TAGS,
  OverpassError
};
