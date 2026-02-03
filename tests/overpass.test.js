/**
 * Tests for Overpass Query Builder and Normalization
 * Run with: npx jest tests/overpass.test.js
 */

const {
  buildOverpassQuery,
  buildOverpassQueryAround,
  normalizeOverpassResponse,
  centerRadiusToBbox,
  getAvailableCategories,
  validateCategories,
  CATEGORY_TAGS
} = require('../src/lib/overpass');

describe('Overpass Query Builder', () => {
  const testBbox = { south: 48.8, west: 2.3, north: 48.9, east: 2.4 };

  describe('buildOverpassQuery', () => {
    it('should build valid query for single category', () => {
      const query = buildOverpassQuery(testBbox, ['museum'], 100);

      expect(query).toContain('[out:json]');
      expect(query).toContain('[timeout:25]');
      expect(query).toContain('[bbox:48.8,2.3,48.9,2.4]');
      expect(query).toContain('["tourism"="museum"]');
      expect(query).toContain('out center tags 100');
    });

    it('should build valid query for multiple categories', () => {
      const query = buildOverpassQuery(testBbox, ['museum', 'park', 'cafe'], 200);

      expect(query).toContain('["tourism"="museum"]');
      expect(query).toContain('["leisure"="park"]');
      expect(query).toContain('["amenity"="cafe"]');
    });

    it('should handle wildcard categories (historic)', () => {
      const query = buildOverpassQuery(testBbox, ['historic'], 100);

      expect(query).toContain('["historic"]');
    });

    it('should throw error for invalid category', () => {
      expect(() => buildOverpassQuery(testBbox, ['invalid_category'], 100))
        .toThrow('Invalid categories: invalid_category');
    });

    it('should include node, way, and relation queries', () => {
      const query = buildOverpassQuery(testBbox, ['museum'], 100);

      expect(query).toContain('node["tourism"="museum"]["name"]');
      expect(query).toContain('way["tourism"="museum"]["name"]');
      expect(query).toContain('relation["tourism"="museum"]["name"]');
    });
  });

  describe('buildOverpassQueryAround', () => {
    it('should build query with around filter', () => {
      const center = { lat: 48.85, lng: 2.35 };
      const query = buildOverpassQueryAround(center, 5000, ['museum'], 100);

      expect(query).toContain('around:5000,48.85,2.35');
      expect(query).toContain('["tourism"="museum"]');
    });
  });

  describe('centerRadiusToBbox', () => {
    it('should convert center+radius to bbox', () => {
      const bbox = centerRadiusToBbox(48.85, 2.35, 5);

      expect(bbox.south).toBeLessThan(48.85);
      expect(bbox.north).toBeGreaterThan(48.85);
      expect(bbox.west).toBeLessThan(2.35);
      expect(bbox.east).toBeGreaterThan(2.35);

      // Roughly 5km in each direction
      const latDiff = bbox.north - bbox.south;
      expect(latDiff).toBeCloseTo(0.09, 1); // ~5km / 111km per degree
    });

    it('should handle different latitudes', () => {
      const equatorBbox = centerRadiusToBbox(0, 0, 10);
      const arcticBbox = centerRadiusToBbox(70, 0, 10);

      // At higher latitudes, longitude range should be wider
      const equatorLngRange = equatorBbox.east - equatorBbox.west;
      const arcticLngRange = arcticBbox.east - arcticBbox.west;

      expect(arcticLngRange).toBeGreaterThan(equatorLngRange);
    });
  });

  describe('validateCategories', () => {
    it('should return true for valid categories', () => {
      expect(validateCategories(['museum', 'park'])).toBe(true);
    });

    it('should throw for invalid categories', () => {
      expect(() => validateCategories(['museum', 'fake']))
        .toThrow('Invalid categories: fake');
    });
  });

  describe('getAvailableCategories', () => {
    it('should return array of category keys', () => {
      const categories = getAvailableCategories();

      expect(Array.isArray(categories)).toBe(true);
      expect(categories).toContain('museum');
      expect(categories).toContain('restaurant');
      expect(categories.length).toBeGreaterThan(10);
    });
  });
});

describe('Overpass Response Normalization', () => {
  const mockResponse = {
    elements: [
      {
        type: 'node',
        id: 123456,
        lat: 48.8584,
        lon: 2.2945,
        tags: {
          name: 'Eiffel Tower',
          tourism: 'attraction',
          website: 'https://www.toureiffel.paris',
          phone: '+33 892 70 12 39',
          opening_hours: 'Mo-Su 09:00-00:45',
          'addr:street': 'Champ de Mars',
          'addr:city': 'Paris',
          'addr:postcode': '75007',
          'addr:country': 'France'
        }
      },
      {
        type: 'way',
        id: 789012,
        center: { lat: 48.8606, lon: 2.3376 },
        tags: {
          name: 'Louvre Museum',
          tourism: 'museum'
        }
      },
      {
        type: 'node',
        id: 111111,
        lat: 48.8,
        lon: 2.3,
        tags: {
          // No name - should be skipped
          tourism: 'viewpoint'
        }
      }
    ]
  };

  it('should normalize nodes correctly', () => {
    const pois = normalizeOverpassResponse(mockResponse, ['attraction', 'museum']);

    const eiffel = pois.find(p => p.osm_id === 123456);
    expect(eiffel).toBeDefined();
    expect(eiffel.osm_type).toBe('node');
    expect(eiffel.name).toBe('Eiffel Tower');
    expect(eiffel.lat).toBe(48.8584);
    expect(eiffel.lng).toBe(2.2945);
    expect(eiffel.category).toBe('attraction');
    expect(eiffel.website).toBe('https://www.toureiffel.paris');
    expect(eiffel.phone).toBe('+33 892 70 12 39');
    expect(eiffel.opening_hours).toBe('Mo-Su 09:00-00:45');
    expect(eiffel.source).toBe('osm');
  });

  it('should normalize ways with center coordinates', () => {
    const pois = normalizeOverpassResponse(mockResponse, ['museum']);

    const louvre = pois.find(p => p.osm_id === 789012);
    expect(louvre).toBeDefined();
    expect(louvre.osm_type).toBe('way');
    expect(louvre.lat).toBe(48.8606);
    expect(louvre.lng).toBe(2.3376);
  });

  it('should extract address correctly', () => {
    const pois = normalizeOverpassResponse(mockResponse, ['attraction']);

    const eiffel = pois.find(p => p.osm_id === 123456);
    expect(eiffel.address).toEqual({
      street: 'Champ de Mars',
      housenumber: null,
      city: 'Paris',
      postcode: '75007',
      country: 'France'
    });
  });

  it('should skip elements without name', () => {
    const pois = normalizeOverpassResponse(mockResponse, ['viewpoint']);

    const nameless = pois.find(p => p.osm_id === 111111);
    expect(nameless).toBeUndefined();
  });

  it('should preserve raw tags', () => {
    const pois = normalizeOverpassResponse(mockResponse, ['attraction']);

    const eiffel = pois.find(p => p.osm_id === 123456);
    expect(eiffel.raw_tags).toEqual(mockResponse.elements[0].tags);
  });

  it('should handle empty response', () => {
    const pois = normalizeOverpassResponse({ elements: [] }, ['museum']);
    expect(pois).toEqual([]);
  });

  it('should handle missing elements array', () => {
    const pois = normalizeOverpassResponse({}, ['museum']);
    expect(pois).toEqual([]);
  });
});
