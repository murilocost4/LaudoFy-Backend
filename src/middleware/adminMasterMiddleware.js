const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.isAdminMaster) {
      return res.status(403).json({ error: 'Access denied. Admin Master only.' });
    }

    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token.' });
  }
}; 