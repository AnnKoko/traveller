const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
