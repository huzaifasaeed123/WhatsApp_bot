require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const whatsappService = require('./services/whatsappService');
const emailService = require('./services/emailService');
const routes = require('./routes');
const CronService = require('./services/cron_service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor_bot')
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// Initialize services
console.log('🚀 Initializing services...');

// Initialize WhatsApp service
console.log('📱 Starting WhatsApp service...');
whatsappService.initialize(io);

// Initialize Email service (only if email credentials are provided)
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  console.log('📧 Starting Email service...');
  emailService.initialize(io);
} else {
  console.log('⚠️ Email credentials not found. Email service disabled.');
  console.log('💡 To enable email monitoring, set EMAIL_USER and EMAIL_PASS in your .env file');
}

// Routes
app.use('/', routes);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('🔌 Client connected');
  
  // Send current service status to new clients
  const whatsappStatus = whatsappService.getStatus();
  const emailStatus = emailService.getStatus();
  
  socket.emit('serviceStatus', {
    whatsapp: whatsappStatus,
    email: emailStatus
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected');
  });

  // Handle manual email check requests
  socket.on('checkEmails', async () => {
    try {
      const result = await emailService.checkForNewEmails();
      socket.emit('emailCheckResult', { success: result });
    } catch (error) {
      socket.emit('emailCheckResult', { success: false, error: error.message });
    }
  });
});

// Start cron service for automatic cleanup
console.log('⏰ Starting cron service...');
const cronService = new CronService(io);
cronService.start();

// Error handling
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop email service
  if (emailService) {
    emailService.stop();
  }
  
  // Close server
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log('💡 Make sure to set up your .env file with required credentials:');
  console.log('   - OPENAI_API_KEY (for AI processing)');
  console.log('   - EMAIL_USER (for email monitoring)');
  console.log('   - EMAIL_PASS (for email monitoring)');
  console.log('   - MONGODB_URI (optional, defaults to localhost)');
});