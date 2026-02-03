/**
 * Tests for POI Cache and Dedupe Logic
 * Run with: npx jest tests/cache.test.js
 */

const {
  generateCacheKey,
  dedupeByOsmId,
  dedupeByProximity,
  dedupePOIs,
  haversineDistance
} = require('../src/lib/cache');

describe('Cache Key Generation', () => {
  it('should generate consistent keys for same inputs', () => {
    const bbox = { south: 48.8, west: 2.3, north: 48.9, east: 2.4 };
    const categories = ['museum', 'park'];

    const key1 = generateCacheKey(bbox, categories);
    const key2 = generateCacheKey(bbox, categories);

    expect(key1).toBe(key2);
  });

  it('should generate same key regardless of category order', () => {
    const bbox = { south: 48.8, west: 2.3, north: 48.9, east: 2.4 };

    const key1 = generateCacheKey(bbox, ['museum', 'park', 'cafe']);
    const key2 = generateCacheKey(bbox, ['cafe', 'museum', 'park']);

    expect(key1).toBe(key2);
  });

  it('should round bbox to 4 decimal places', () => {
    const bbox1 = { south: 48.80001, west: 2.30002, north: 48.90003, east: 2.40004 };
    const bbox2 = { south: 48.80009, west: 2.30008, north: 48.90007, east: 2.40006 };

    const key1 = generateCacheKey(bbox1, ['museum']);
    const key2 = generateCacheKey(bbox2, ['museum']);

    expect(key1).toBe(key2);
  });

  it('should generate different keys for different bboxes', () => {
    const bbox1 = { south: 48.8, west: 2.3, north: 48.9, east: 2.4 };
    const bbox2 = { south: 48.7, west: 2.2, north: 48.8, east: 2.3 };

    const key1 = generateCacheKey(bbox1, ['museum']);
    const key2 = generateCacheKey(bbox2, ['museum']);

    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different categories', () => {
    const bbox = { south: 48.8, west: 2.3, north: 48.9, east: 2.4 };

    const key1 = generateCacheKey(bbox, ['museum']);
    const key2 = generateCacheKey(bbox, ['park']);

    expect(key1).not.toBe(key2);
  });

  it('should return 64-character hex string (SHA-256)', () => {
    const key = generateCacheKey(
      { south: 48.8, west: 2.3, north: 48.9, east: 2.4 },
      ['museum']
    );

    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Haversine Distance', () => {
  it('should calculate zero distance for same point', () => {
    const distance = haversineDistance(48.85, 2.35, 48.85, 2.35);
    expect(distance).toBe(0);
  });

  it('should calculate approximately correct distance', () => {
    // Paris to London is roughly 344km
    const distance = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278);
    expect(distance).toBeGreaterThan(340000);
    expect(distance).toBeLessThan(350000);
  });

  it('should be symmetric', () => {
    const d1 = haversineDistance(48.85, 2.35, 51.50, -0.12);
    const d2 = haversineDistance(51.50, -0.12, 48.85, 2.35);
    expect(Math.abs(d1 - d2)).toBeLessThan(1); // Less than 1 meter difference
  });
});

describe('Dedupe by OSM ID', () => {
  const pois = [
    { osm_type: 'node', osm_id: 1, name: 'Place A' },
    { osm_type: 'node', osm_id: 2, name: 'Place B' },
    { osm_type: 'node', osm_id: 1, name: 'Place A Duplicate' }, // Duplicate
    { osm_type: 'way', osm_id: 1, name: 'Place C' }, // Different type, same ID
    { osm_type: 'node', osm_id: 3, name: 'Place D' },
  ];

  it('should remove duplicates with same type and id', () => {
    const result = dedupeByOsmId(pois);

    expect(result.length).toBe(4);
    expect(result.filter(p => p.osm_type === 'node' && p.osm_id === 1).length).toBe(1);
  });

  it('should keep first occurrence', () => {
    const result = dedupeByOsmId(pois);

    const kept = result.find(p => p.osm_type === 'node' && p.osm_id === 1);
    expect(kept.name).toBe('Place A'); // First one, not duplicate
  });

  it('should handle different types with same ID', () => {
    const result = dedupeByOsmId(pois);

    expect(result.filter(p => p.osm_id === 1).length).toBe(2); // node:1 and way:1
  });

  it('should handle empty array', () => {
    expect(dedupeByOsmId([])).toEqual([]);
  });
});

describe('Dedupe by Proximity', () => {
  const pois = [
    { osm_type: 'node', osm_id: 1, name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945 },
    { osm_type: 'way', osm_id: 2, name: 'Eiffel Tower', lat: 48.8584, lng: 2.2946 }, // ~8m away
    { osm_type: 'node', osm_id: 3, name: 'Louvre Museum', lat: 48.8606, lng: 2.3376 },
    { osm_type: 'node', osm_id: 4, name: 'LOUVRE museum', lat: 48.8607, lng: 2.3377 }, // Similar name, ~15m away
    { osm_type: 'node', osm_id: 5, name: 'Arc de Triomphe', lat: 48.8738, lng: 2.295 },
  ];

  it('should merge POIs with same name within threshold', () => {
    const result = dedupeByProximity(pois, 50);

    // Should merge Eiffel Tower duplicates
    expect(result.filter(p => p.name.toLowerCase().includes('eiffel')).length).toBe(1);
  });

  it('should normalize names for comparison', () => {
    const result = dedupeByProximity(pois, 50);

    // Should merge "Louvre Museum" and "LOUVRE museum"
    expect(result.filter(p => p.name.toLowerCase().includes('louvre')).length).toBe(1);
  });

  it('should not merge distant POIs with same name', () => {
    const distantPois = [
      { osm_type: 'node', osm_id: 1, name: 'Starbucks', lat: 48.85, lng: 2.35 },
      { osm_type: 'node', osm_id: 2, name: 'Starbucks', lat: 48.90, lng: 2.40 }, // ~7km away
    ];

    const result = dedupeByProximity(distantPois, 50);
    expect(result.length).toBe(2);
  });

  it('should handle empty array', () => {
    expect(dedupeByProximity([], 50)).toEqual([]);
  });

  it('should respect distance threshold', () => {
    const closePois = [
      { osm_type: 'node', osm_id: 1, name: 'Test Place', lat: 48.85, lng: 2.35 },
      { osm_type: 'node', osm_id: 2, name: 'Test Place', lat: 48.85001, lng: 2.35001 }, // ~1.5m away
    ];

    const result1m = dedupeByProximity(closePois, 1);
    expect(result1m.length).toBe(2); // Too close threshold, not merged

    const result10m = dedupeByProximity(closePois, 10);
    expect(result10m.length).toBe(1); // Merged within 10m
  });
});

describe('Full Dedupe Pipeline', () => {
  it('should apply both strict and soft dedupe by default', () => {
    const pois = [
      { osm_type: 'node', osm_id: 1, name: 'Place A', lat: 48.85, lng: 2.35 },
      { osm_type: 'node', osm_id: 1, name: 'Place A Dup', lat: 48.85, lng: 2.35 }, // OSM dupe
      { osm_type: 'way', osm_id: 2, name: 'Place A', lat: 48.85001, lng: 2.35001 }, // Proximity dupe
    ];

    const result = dedupePOIs(pois);
    expect(result.length).toBe(1);
  });

  it('should skip soft dedupe when disabled', () => {
    const pois = [
      { osm_type: 'node', osm_id: 1, name: 'Place A', lat: 48.85, lng: 2.35 },
      { osm_type: 'way', osm_id: 2, name: 'Place A', lat: 48.85001, lng: 2.35001 },
    ];

    const result = dedupePOIs(pois, { softDedupe: false });
    expect(result.length).toBe(2); // Only OSM dedupe applied
  });
});
