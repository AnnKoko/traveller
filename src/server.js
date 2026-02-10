const express = require('express');
const path = require('path');
const { handleOsmImportDemo } = require('./api/osm/demo');
const { getAvailableCategories } = require('./lib/overpass');
const { searchPlace } = require('./lib/nominatim');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// OSM Import endpoint (demo mode - no auth required)
app.post('/api/osm/import', handleOsmImportDemo);

// Get available categories
app.get('/api/osm/categories', (req, res) => {
  res.json(getAvailableCategories());
});

// Search for cities/places (Nominatim)
app.get('/api/geocode/search', async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }
    const results = await searchPlace(q, { limit: parseInt(limit) });
    res.json(results);
  } catch (error) {
    console.error('Geocode error:', error);
    res.status(500).json({ error: error.message });
  }
});

const destinations = [
  { id: 1, name: 'Paris', country: 'France' },
  { id: 2, name: 'Tokyo', country: 'Japan' },
  { id: 3, name: 'New York', country: 'USA' }
];

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/destinations', (req, res) => {
  res.json(destinations);
});

app.get('/api/destinations/:id', (req, res) => {
  const dest = destinations.find(d => d.id === parseInt(req.params.id));
  if (!dest) return res.status(404).json({ error: 'Not found' });
  res.json(dest);
});

// Google Directions API proxy
app.get('/api/directions', async (req, res) => {
  const { origin, destination, mode = 'transit' } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination required' });
  }

  // Check if API key is configured
  if (!GOOGLE_API_KEY) {
    // Return walking estimate as fallback
    const [originLat, originLng] = origin.split(',').map(Number);
    const [destLat, destLng] = destination.split(',').map(Number);
    const distance = haversineDistance(originLat, originLng, destLat, destLng);
    const walkMinutes = Math.round(distance / 5 * 60);

    return res.json({
      status: 'NO_API_KEY',
      fallback: true,
      routes: [{
        legs: [{
          distance: { text: `${distance.toFixed(1)} км`, value: distance * 1000 },
          duration: { text: `${walkMinutes} хв пішки`, value: walkMinutes * 60 },
          steps: [{ travel_mode: 'WALKING', html_instructions: 'Пішки' }]
        }]
      }]
    });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=${mode}&alternatives=true&language=uk&key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Directions API error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check if Google API is configured
app.get('/api/config', (req, res) => {
  res.json({
    hasGoogleApi: !!GOOGLE_API_KEY,
    features: {
      transit: !!GOOGLE_API_KEY,
      walking: true
    }
  });
});

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

app.listen(PORT, () => {
  console.log(`Explorer app running on http://localhost:${PORT}`);
  if (GOOGLE_API_KEY) {
    console.log('✓ Google Directions API enabled');
  } else {
    console.log('ℹ Google API key not set. Set GOOGLE_API_KEY env var for transit routes.');
  }
});
