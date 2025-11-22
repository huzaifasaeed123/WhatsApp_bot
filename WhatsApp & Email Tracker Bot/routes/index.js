const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Admin panel routes
router.get('/', adminController.loginPage);
router.get('/groups', adminController.groupsPage);
router.post('/track-groups', adminController.trackGroups);
router.get('/dashboard', adminController.dashboard);

// Enhanced API routes for comprehensive filtering
router.get('/api/messages', adminController.getMessages);
router.get('/api/export-excel', adminController.exportExcel);
router.get('/api/service-status', adminController.getServiceStatus);
router.post('/api/check-emails', adminController.checkEmails);

// New routes for automated responses and templates
router.post('/api/send-response', adminController.sendAutomatedResponse);
router.get('/api/templates', adminController.getResponseTemplates);
router.post('/api/templates', adminController.updateResponseTemplates);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    services: {
      whatsapp: 'Active',
      email: 'Active',
      database: 'Connected'
    }
  });
});

module.exports = router;