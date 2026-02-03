# Explore Nearby with OpenStreetMap - Feature Spec

## 1. Feature Overview

Import Points of Interest (POIs) from OpenStreetMap via Overpass API, display them on a map with list view, and allow users to add selected POIs to their trip activities.

## 2. User Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Discover   │───▶│   Import    │───▶│ Review List │───▶│ Add to Trip │
│  (Search)   │    │  (Fetch)    │    │  (Map+List) │    │ (Activities)│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Step 1: Discover
- User searches for a city/area OR pans map to location
- User selects categories (checkboxes)
- User optionally adjusts radius (default 5km)
- User clicks "Explore"

### Step 2: Import
- Server fetches from Overpass (or cache)
- Loading indicator with progress
- Rate limit/timeout handled gracefully

### Step 3: Review List
- Split view: Map (left) + List (right)
- List shows: Name, Category icon, Distance, Address snippet
- Map shows clustered pins by category color
- Click pin → highlight in list (and vice versa)
- Checkbox to select multiple POIs

### Step 4: Add to Trip
- User selects POIs via checkboxes
- Clicks "Add to Trip" button
- POIs become Activities in current trip
- Success toast with count

## 3. Supported Categories

| Category Key    | OSM Tags                                      | Icon    |
|-----------------|-----------------------------------------------|---------|
| `museum`        | tourism=museum                                | 🏛️      |
| `attraction`    | tourism=attraction                            | ⭐      |
| `viewpoint`     | tourism=viewpoint                             | 👁️      |
| `park`          | leisure=park                                  | 🌳      |
| `beach`         | natural=beach                                 | 🏖️      |
| `market`        | amenity=marketplace                           | 🛒      |
| `restaurant`    | amenity=restaurant                            | 🍽️      |
| `cafe`          | amenity=cafe                                  | ☕      |
| `bar`           | amenity=bar                                   | 🍺      |
| `hotel`         | tourism=hotel                                 | 🏨      |
| `historic`      | historic=*                                    | 🏰      |
| `religious`     | amenity=place_of_worship                      | ⛪      |
| `theatre`       | amenity=theatre                               | 🎭      |
| `cinema`        | amenity=cinema                                | 🎬      |
| `gallery`       | tourism=gallery                               | 🖼️      |
| `zoo`           | tourism=zoo                                   | 🦁      |
| `aquarium`      | tourism=aquarium                              | 🐠      |
| `theme_park`    | tourism=theme_park                            | 🎢      |
| `swimming`      | leisure=swimming_pool, sport=swimming         | 🏊      |
| `nightclub`     | amenity=nightclub                             | 🎉      |

## 4. Filters/Parameters

| Parameter      | Type            | Required | Default | Description                    |
|----------------|-----------------|----------|---------|--------------------------------|
| `trip_id`      | UUID            | Yes      | -       | Target trip for activities     |
| `bbox`         | [s,w,n,e]       | One of   | -       | Bounding box (lat/lng)         |
| `center`       | {lat, lng}      | One of   | -       | Center point                   |
| `radius_km`    | number          | If center| 5       | Radius in kilometers           |
| `categories`   | string[]        | Yes      | -       | Category keys to fetch         |
| `limit`        | number          | No       | 100     | Max POIs (hard cap: 300)       |

## 5. Error States

| Error                  | HTTP | User Message                                    | Recovery                  |
|------------------------|------|-------------------------------------------------|---------------------------|
| Overpass timeout       | 504  | "Search took too long. Try a smaller area."     | Reduce radius/categories  |
| Overpass rate limit    | 429  | "Too many requests. Please wait a moment."      | Auto-retry after 30s      |
| Empty results          | 200  | "No places found. Try different categories."    | Expand search             |
| Invalid bbox           | 400  | "Invalid search area."                          | Re-select on map          |
| Trip not found         | 404  | "Trip not found."                               | Return to trips list      |
| Unauthorized           | 401  | "Please log in to continue."                    | Redirect to login         |

## 6. Normalized POI Schema

```typescript
interface POI {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  name: string;
  lat: number;
  lng: number;
  category: string;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  address: {
    street: string | null;
    housenumber: string | null;
    city: string | null;
    postcode: string | null;
    country: string | null;
  } | null;
  raw_tags: Record<string, string>;
  source: 'osm';
}
```
