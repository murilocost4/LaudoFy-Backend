const adminMiddleware = (req, res, next) => {
  try {
    // Check if user exists and has admin master privileges
    if (!req.usuario || !req.usuario.isAdminMaster) {
      return res.status(403).json({
        error: 'Access denied. Admin Master privileges required.',
        code: 'ADMIN_MASTER_REQUIRED'
      });
    }

    next();
  } catch (err) {
    res.status(500).json({
      error: 'Error checking admin privileges',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = adminMiddleware; 