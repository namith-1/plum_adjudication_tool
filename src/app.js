const path = require('path');
const cors = require('cors');
const express = require('express');
const claimRoutes = require('./routes/claimRoutes');
const extractionRoutes = require('./routes/extractionRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/claims', claimRoutes);
app.use('/api/extractions', extractionRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    error: error.message || 'Internal server error',
    details: error.details,
  });
});

module.exports = app;
