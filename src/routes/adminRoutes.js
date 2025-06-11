const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Apply auth and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// Dashboard statistics
router.get('/stats', adminController.getStats);
router.get('/tenant-stats', adminController.getTenantStats);
router.get('/system-health', adminController.getSystemHealth);
router.get('/recent-activity', adminController.getRecentActivity);

// Tenant management
router.get('/tenant/:tenantId', adminController.getTenantDetails);

// System monitoring
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/performance', adminController.getPerformanceMetrics);

module.exports = router; 