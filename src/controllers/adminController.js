const Usuario = require('../models/Usuario');
const Tenant = require('../models/Tenant');
const Laudo = require('../models/Laudo');
const AuditLog = require('../models/AuditModel');
const os = require('os');
const { startOfMonth, endOfMonth, subDays } = require('date-fns');

// Get overall system statistics
exports.getStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfThisMonth = startOfMonth(now);
    const endOfThisMonth = endOfMonth(now);

    const [
      totalTenants,
      totalUsers,
      totalReports,
      newTenantsThisMonth,
      newUsersThisMonth,
      reportsThisMonth
    ] = await Promise.all([
      Tenant.countDocuments(),
      Usuario.countDocuments(),
      Laudo.countDocuments(),
      Tenant.countDocuments({
        createdAt: { $gte: startOfThisMonth, $lte: endOfThisMonth }
      }),
      Usuario.countDocuments({
        createdAt: { $gte: startOfThisMonth, $lte: endOfThisMonth }
      }),
      Laudo.countDocuments({
        createdAt: { $gte: startOfThisMonth, $lte: endOfThisMonth }
      })
    ]);

    res.json({
      totalTenants,
      totalUsers,
      totalReports,
      newTenantsThisMonth,
      newUsersThisMonth,
      reportsThisMonth
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get tenant activity statistics
exports.getTenantStats = async (req, res) => {
  try {
    const thirtyDaysAgo = subDays(new Date(), 30);

    const stats = await AuditLog.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            tenant: "$tenant_id"
          },
          active: { $sum: 1 },
          reports: {
            $sum: {
              $cond: [
                { $eq: ["$collectionName", "laudos"] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $group: {
          _id: "$_id.date",
          active: { $sum: "$active" },
          reports: { $sum: "$reports" }
        }
      },
      {
        $project: {
          date: "$_id",
          active: 1,
          reports: 1,
          _id: 0
        }
      },
      {
        $sort: { date: 1 }
      }
    ]);

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get system health metrics
exports.getSystemHealth = async (req, res) => {
  try {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;

    const cpuUsage = os.loadavg()[0] * 100 / os.cpus().length;
    
    const diskSpace = {
      total: 1000, // Placeholder - implement actual disk space check
      used: 400    // Placeholder - implement actual disk space check
    };
    const diskUsage = (diskSpace.used / diskSpace.total) * 100;

    const resources = [
      { name: 'CPU', usage: Math.round(cpuUsage) },
      { name: 'Memory', usage: Math.round(memoryUsage) },
      { name: 'Disk', usage: Math.round(diskUsage) }
    ];

    const status = resources.every(r => r.usage < 80) ? 'Good' : 'Warning';
    const uptime = Math.floor(os.uptime() / 3600); // Convert to hours

    res.json({
      status,
      uptime: `${uptime}h`,
      resources
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get recent system activity
exports.getRecentActivity = async (req, res) => {
  try {
    const recentLogs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('tenant_id', 'nomeFantasia')
      .lean();

    const activity = recentLogs.map(log => ({
      type: log.status === 'failed' ? 'error' : 
            log.action === 'warning' ? 'warning' : 'success',
      message: log.description,
      tenant: log.tenant_id?.nomeFantasia || 'System',
      timestamp: log.createdAt
    }));

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get tenant-specific statistics
exports.getTenantDetails = async (req, res) => {
  try {
    const { tenantId } = req.params;
    
    const [
      userCount,
      reportCount,
      recentActivity
    ] = await Promise.all([
      Usuario.countDocuments({ tenant_id: tenantId }),
      Laudo.countDocuments({ tenant_id: tenantId }),
      AuditLog.find({ tenant_id: tenantId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      tenant,
      stats: {
        userCount,
        reportCount,
        recentActivity
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get system audit logs with filtering
exports.getAuditLogs = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      action,
      tenant,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (action) {
      query.action = action;
    }

    if (tenant) {
      query.tenant_id = tenant;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('tenant_id', 'nomeFantasia')
        .populate('userId', 'nome email'),
      AuditLog.countDocuments(query)
    ]);

    res.json({
      logs,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get system performance metrics
exports.getPerformanceMetrics = async (req, res) => {
  try {
    const metrics = {
      cpu: {
        usage: Math.round(os.loadavg()[0] * 100 / os.cpus().length),
        cores: os.cpus().length
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      uptime: os.uptime(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version
    };

    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}; 