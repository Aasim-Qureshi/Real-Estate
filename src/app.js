require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require("./db/connection")
const mongoose = require('mongoose');

// Import routes
const estateRoutes = require('./presentation/routes/estate.routes');
const pythonWorker = require('./presentation/routes/pythonWorker.routes');
const taqeemAuth = require('./presentation/routes/taqeemAuth.routes');
const validateRoutes = require('./presentation/routes/validator.routes');

const app = express();

connectDB();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Mount routes
app.use('/api/estate', estateRoutes);
app.use('/api/python', pythonWorker);
app.use('/api/taqeemAuth', taqeemAuth);
app.use('/api/validate', validateRoutes);


app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Server is running',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// 404 handler for undefined routes
app.use('/*splat', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;