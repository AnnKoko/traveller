/**
 * Nominatim Geocoding API Client
 * Free geocoding service by OpenStreetMap
 * https://nominatim.org/release-docs/latest/api/Overview/
 */

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'Explorer/1.0 (https://github.com/explorer-app; contact@explorer.app)';

/**
 * Search for a place by name
 * @param {string} query - Search query (city name, address, etc.)
 * @param {object} options
 * @param {number} options.limit - Max results (default 5)
 * @param {string} options.countrycodes - Comma-separated country codes (e.g., 'fr,br')
 * @returns {Promise<Array>} Search results
 */
async function searchPlace(query, options = {}) {
  const { limit = 5, countrycodes } = options;

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: limit.toString(),
    addressdetails: '1'
  });

  if (countrycodes) {
    params.set('countrycodes', countrycodes);
  }

  const response = await fetch(`${NOMINATIM_ENDPOINT}/search?${params}`, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  const results = await response.json();

  return results.map(r => ({
    display_name: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    type: r.type,
    importance: r.importance,
    address: {
      city: r.address?.city || r.address?.town || r.address?.village,
      state: r.address?.state,
      country: r.address?.country,
      country_code: r.address?.country_code
    },
    bbox: r.boundingbox ? {
      south: parseFloat(r.boundingbox[0]),
      north: parseFloat(r.boundingbox[1]),
      west: parseFloat(r.boundingbox[2]),
      east: parseFloat(r.boundingbox[3])
    } : null,
    osm_id: r.osm_id,
    osm_type: r.osm_type
  }));
}

/**
 * Reverse geocode coordinates to address
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object>} Address details
 */
async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lng.toString(),
    format: 'json',
    addressdetails: '1'
  });

  const response = await fetch(`${NOMINATIM_ENDPOINT}/reverse?${params}`, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Nominatim error: ${response.status}`);
  }

  const result = await response.json();

  return {
    display_name: result.display_name,
    address: {
      street: result.address?.road,
      housenumber: result.address?.house_number,
      city: result.address?.city || result.address?.town || result.address?.village,
      state: result.address?.state,
      postcode: result.address?.postcode,
      country: result.address?.country,
      country_code: result.address?.country_code
    }
  };
}

module.exports = {
  searchPlace,
  reverseGeocode
};
