require('dotenv').config();
const app = require('./app');
const http = require('http');
const socketService = require('./services/socketService');

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketService.initialize(server);

// Make io available to other modules
app.set('io', io);

// Start server
server.listen(PORT, () => {
  console.log(`
  🚀 Server running in ${process.env.NODE_ENV || 'development'} mode
  📍 Port: ${PORT}
  🔗 Health check: http://localhost:${PORT}/health
  ⏰ Started at: ${new Date().toISOString()}
  📡 Socket.IO server active
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log('Unhandled Rejection at:', promise, 'Reason:', err);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception thrown:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Clean up all user sessions
  for (const userId of socketService.userSessions.keys()) {
    const userSession = socketService.userSessions.get(userId);
    if (userSession && userSession.cleanupTimeout) {
      clearTimeout(userSession.cleanupTimeout);
    }
    socketService.performCleanupByUserId(userId);
  }
  
  server.close(() => {
    console.log('Process terminated');
  });
});

// Export for testing
module.exports = { server, io: socketService.getIO() };