/**
 * Discover POIs Component
 * React component for exploring and importing OSM POIs
 *
 * Usage:
 *   <DiscoverPOIs tripId="uuid" onAddActivities={(pois) => ...} />
 */

import React, { useState, useCallback, useMemo } from 'react';

// Category definitions with icons
const CATEGORIES = [
  { key: 'museum', label: 'Museums', icon: '🏛️' },
  { key: 'attraction', label: 'Attractions', icon: '⭐' },
  { key: 'viewpoint', label: 'Viewpoints', icon: '👁️' },
  { key: 'park', label: 'Parks', icon: '🌳' },
  { key: 'beach', label: 'Beaches', icon: '🏖️' },
  { key: 'market', label: 'Markets', icon: '🛒' },
  { key: 'restaurant', label: 'Restaurants', icon: '🍽️' },
  { key: 'cafe', label: 'Cafes', icon: '☕' },
  { key: 'bar', label: 'Bars', icon: '🍺' },
  { key: 'hotel', label: 'Hotels', icon: '🏨' },
  { key: 'historic', label: 'Historic Sites', icon: '🏰' },
  { key: 'religious', label: 'Religious Sites', icon: '⛪' },
  { key: 'theatre', label: 'Theatres', icon: '🎭' },
  { key: 'gallery', label: 'Galleries', icon: '🖼️' },
  { key: 'zoo', label: 'Zoos', icon: '🦁' },
];

// API client for OSM import
async function importPOIs({ tripId, center, radiusKm, categories, limit }) {
  const response = await fetch('/api/osm/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trip_id: tripId,
      center,
      radius_km: radiusKm,
      categories,
      limit
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to import POIs');
  }

  return response.json();
}

// State reducer for complex state management
function reducer(state, action) {
  switch (action.type) {
    case 'SET_CENTER':
      return { ...state, center: action.payload };
    case 'SET_RADIUS':
      return { ...state, radiusKm: action.payload };
    case 'TOGGLE_CATEGORY':
      const categories = state.selectedCategories.includes(action.payload)
        ? state.selectedCategories.filter(c => c !== action.payload)
        : [...state.selectedCategories, action.payload];
      return { ...state, selectedCategories: categories };
    case 'SET_LOADING':
      return { ...state, loading: action.payload, error: null };
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'SET_RESULTS':
      return {
        ...state,
        loading: false,
        pois: action.payload.pois,
        meta: action.payload.meta,
        selectedPois: new Set()
      };
    case 'TOGGLE_POI':
      const selected = new Set(state.selectedPois);
      if (selected.has(action.payload)) {
        selected.delete(action.payload);
      } else {
        selected.add(action.payload);
      }
      return { ...state, selectedPois: selected };
    case 'SELECT_ALL':
      return {
        ...state,
        selectedPois: new Set(state.pois.map(p => `${p.osm_type}:${p.osm_id}`))
      };
    case 'CLEAR_SELECTION':
      return { ...state, selectedPois: new Set() };
    default:
      return state;
  }
}

const initialState = {
  center: null,
  radiusKm: 5,
  selectedCategories: ['museum', 'attraction', 'viewpoint'],
  loading: false,
  error: null,
  pois: [],
  meta: null,
  selectedPois: new Set()
};

export function DiscoverPOIs({ tripId, onAddActivities, initialCenter }) {
  const [state, dispatch] = React.useReducer(reducer, {
    ...initialState,
    center: initialCenter
  });

  const {
    center,
    radiusKm,
    selectedCategories,
    loading,
    error,
    pois,
    meta,
    selectedPois
  } = state;

  // Handle explore button click
  const handleExplore = useCallback(async () => {
    if (!center || selectedCategories.length === 0) return;

    dispatch({ type: 'SET_LOADING', payload: true });

    try {
      const result = await importPOIs({
        tripId,
        center,
        radiusKm,
        categories: selectedCategories,
        limit: 100
      });
      dispatch({ type: 'SET_RESULTS', payload: result });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
    }
  }, [tripId, center, radiusKm, selectedCategories]);

  // Handle add to trip
  const handleAddToTrip = useCallback(() => {
    const selectedList = pois.filter(
      p => selectedPois.has(`${p.osm_type}:${p.osm_id}`)
    );
    if (selectedList.length > 0 && onAddActivities) {
      onAddActivities(selectedList);
    }
  }, [pois, selectedPois, onAddActivities]);

  // Group POIs by category for display
  const poisByCategory = useMemo(() => {
    const groups = {};
    for (const poi of pois) {
      if (!groups[poi.category]) groups[poi.category] = [];
      groups[poi.category].push(poi);
    }
    return groups;
  }, [pois]);

  return (
    <div className="discover-pois">
      {/* Search Controls */}
      <div className="discover-controls">
        <div className="location-input">
          <label>Location</label>
          <input
            type="text"
            placeholder="Search city or click map..."
            // In production, integrate with Nominatim or map click
          />
        </div>

        <div className="radius-input">
          <label>Radius: {radiusKm} km</label>
          <input
            type="range"
            min="1"
            max="20"
            value={radiusKm}
            onChange={e => dispatch({
              type: 'SET_RADIUS',
              payload: parseInt(e.target.value)
            })}
          />
        </div>

        <div className="category-picker">
          <label>Categories</label>
          <div className="category-grid">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className={`category-btn ${
                  selectedCategories.includes(cat.key) ? 'selected' : ''
                }`}
                onClick={() => dispatch({
                  type: 'TOGGLE_CATEGORY',
                  payload: cat.key
                })}
              >
                <span className="icon">{cat.icon}</span>
                <span className="label">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          className="explore-btn"
          onClick={handleExplore}
          disabled={loading || !center || selectedCategories.length === 0}
        >
          {loading ? 'Exploring...' : 'Explore'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Results */}
      {pois.length > 0 && (
        <div className="discover-results">
          <div className="results-header">
            <span>{pois.length} places found</span>
            {meta?.from_cache && <span className="cache-badge">Cached</span>}
            <div className="selection-controls">
              <button onClick={() => dispatch({ type: 'SELECT_ALL' })}>
                Select All
              </button>
              <button onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}>
                Clear
              </button>
            </div>
          </div>

          <div className="results-layout">
            {/* Map placeholder - integrate with Leaflet/Mapbox */}
            <div className="results-map">
              <div className="map-placeholder">
                Map View
                <br />
                (Integrate with Leaflet or Mapbox)
              </div>
            </div>

            {/* POI List */}
            <div className="results-list">
              {Object.entries(poisByCategory).map(([category, categoryPois]) => (
                <div key={category} className="category-group">
                  <h3>
                    {CATEGORIES.find(c => c.key === category)?.icon}{' '}
                    {CATEGORIES.find(c => c.key === category)?.label || category}
                    <span className="count">({categoryPois.length})</span>
                  </h3>
                  <ul>
                    {categoryPois.map(poi => {
                      const key = `${poi.osm_type}:${poi.osm_id}`;
                      return (
                        <li
                          key={key}
                          className={selectedPois.has(key) ? 'selected' : ''}
                          onClick={() => dispatch({
                            type: 'TOGGLE_POI',
                            payload: key
                          })}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPois.has(key)}
                            onChange={() => {}}
                          />
                          <div className="poi-info">
                            <strong>{poi.name}</strong>
                            {poi.address?.street && (
                              <span className="address">
                                {poi.address.street}
                                {poi.address.housenumber && ` ${poi.address.housenumber}`}
                              </span>
                            )}
                            {poi.opening_hours && (
                              <span className="hours">{poi.opening_hours}</span>
                            )}
                          </div>
                          {poi.website && (
                            <a
                              href={poi.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                            >
                              🔗
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Add to Trip Button */}
          {selectedPois.size > 0 && (
            <div className="add-to-trip-bar">
              <button onClick={handleAddToTrip}>
                Add {selectedPois.size} place{selectedPois.size > 1 ? 's' : ''} to Trip
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && pois.length === 0 && meta && (
        <div className="empty-state">
          No places found. Try different categories or a larger radius.
        </div>
      )}
    </div>
  );
}

export default DiscoverPOIs;
