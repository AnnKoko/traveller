const express = require('express');
const path = require('path');
const { handleOsmImportDemo } = require('./api/osm/demo');
const { getAvailableCategories } = require('./lib/overpass');
const { searchPlace } = require('./lib/nominatim');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Traveller app running on http://localhost:${PORT}`);
});
