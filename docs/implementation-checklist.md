# OSM Explore Feature - Implementation Checklist (7 Days)

## Day 1: Project Setup & Database

### Morning
- [ ] Initialize Next.js project with TypeScript (if migrating from Express)
- [ ] Set up Supabase project
- [ ] Configure environment variables (.env.local)
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  ```
- [ ] Run database migrations (copy `database-schema.sql` to Supabase SQL editor)

### Afternoon
- [ ] Verify tables created: `trips`, `activities`, `poi_cache`
- [ ] Test RLS policies with different user contexts
- [ ] Add seed data for testing (create test trip)
- [ ] Set up Supabase client in project (`lib/supabase.ts`)

**Deliverable:** Working database with RLS policies, test trip created

---

## Day 2: Overpass Integration

### Morning
- [ ] Copy `lib/overpass.js` to project
- [ ] Convert to TypeScript (optional but recommended)
- [ ] Write unit tests for query builder
- [ ] Test with Overpass API directly (curl/Postman)

### Afternoon
- [ ] Run tests: `npm test -- overpass.test.js`
- [ ] Fix any issues with query generation
- [ ] Test different category combinations
- [ ] Test edge cases (large bbox, many categories)
- [ ] Add rate limit handling (User-Agent header verified)

**Deliverable:** Working Overpass query builder with passing tests

---

## Day 3: Caching Layer

### Morning
- [ ] Copy `lib/cache.js` to project
- [ ] Convert to TypeScript (optional)
- [ ] Implement cache lookup in database
- [ ] Test cache key generation consistency

### Afternoon
- [ ] Implement cache write on successful fetch
- [ ] Add cache stampede prevention (lock mechanism)
- [ ] Write cache tests: `npm test -- cache.test.js`
- [ ] Test TTL expiration logic
- [ ] Add cache cleanup function (optional: pg_cron job)

**Deliverable:** Working cache with stampede prevention, passing tests

---

## Day 4: API Endpoint

### Morning
- [ ] Create API route (`app/api/osm/import/route.ts` or Express route)
- [ ] Implement request validation
- [ ] Add authentication middleware
- [ ] Implement trip ownership check

### Afternoon
- [ ] Wire up Overpass fetcher with cache
- [ ] Add proper error handling for all cases
- [ ] Test with Postman/curl:
  ```bash
  curl -X POST http://localhost:3000/api/osm/import \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <token>" \
    -d '{
      "trip_id": "uuid",
      "center": {"lat": 48.85, "lng": 2.35},
      "radius_km": 5,
      "categories": ["museum", "attraction"],
      "limit": 50
    }'
  ```
- [ ] Verify cache hit/miss behavior

**Deliverable:** Working API endpoint with authentication and caching

---

## Day 5: Frontend - Core Components

### Morning
- [ ] Set up React component structure
- [ ] Copy `DiscoverPOIs.jsx` and `DiscoverPOIs.css`
- [ ] Install dependencies: `npm install @supabase/supabase-js`
- [ ] Set up state management (useReducer or Zustand)

### Afternoon
- [ ] Implement category picker UI
- [ ] Implement radius slider
- [ ] Add location search (optional: Nominatim integration)
- [ ] Connect to API endpoint
- [ ] Handle loading states

**Deliverable:** Working Discover panel with category selection and API integration

---

## Day 6: Frontend - Map & List

### Morning
- [ ] Install map library: `npm install leaflet react-leaflet`
- [ ] Create map component with POI markers
- [ ] Implement marker clustering (optional: `react-leaflet-cluster`)
- [ ] Color-code markers by category

### Afternoon
- [ ] Implement POI list view
- [ ] Add selection checkboxes
- [ ] Implement map-list interaction (click pin → highlight in list)
- [ ] Add "Add to Trip" functionality
- [ ] Create success toast on add

**Deliverable:** Complete Discover UI with map, list, and add-to-trip

---

## Day 7: Testing & Polish

### Morning
- [ ] Write integration tests for API endpoint
- [ ] Test with mock Overpass responses
- [ ] Test error states (timeout, rate limit, empty results)
- [ ] Test with real cities (Paris, Tokyo, NYC)

### Afternoon
- [ ] Fix any UI/UX issues
- [ ] Add loading skeletons
- [ ] Optimize bundle size
- [ ] Performance testing (cache hit speed)
- [ ] Documentation review

**Deliverable:** Production-ready feature with tests

---

## Test Plan Summary

### Unit Tests
| Component | Test File | Coverage |
|-----------|-----------|----------|
| Overpass Query Builder | `overpass.test.js` | Query generation, bbox/radius, normalization |
| Cache | `cache.test.js` | Key generation, dedupe, distance calc |

### Integration Tests
| Scenario | Expected Result |
|----------|-----------------|
| Fetch POIs (no cache) | Returns POIs, stores in cache |
| Fetch POIs (cache hit) | Returns cached POIs, no Overpass call |
| Invalid trip_id | 404 error |
| Unauthorized user | 401 error |
| Overpass timeout | 504 with retry message |
| Empty results | 200 with empty array |

### Edge Cases
- [ ] Very large bbox (should reject)
- [ ] Invalid categories (should reject)
- [ ] 300+ POIs (pagination)
- [ ] Unicode POI names
- [ ] Missing address data
- [ ] Ways/relations without center coords

---

## Post-Launch Tasks

- [ ] Set up cache cleanup cron job
- [ ] Add analytics (search patterns, popular categories)
- [ ] Consider Nominatim integration for city search
- [ ] Add "Save Search" feature
- [ ] Implement offline support (PWA)
