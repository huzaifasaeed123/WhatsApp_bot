const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Admin panel routes
router.get('/', adminController.loginPage);
router.get('/groups', adminController.groupsPage);
router.post('/track-groups', adminController.trackGroups);
router.get('/dashboard', adminController.dashboard);

// API routes
router.get('/api/messages', adminController.getMessages);

module.exports = router;
