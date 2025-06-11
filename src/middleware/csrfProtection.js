const csrf = require('csurf');

const isProduction = process.env.NODE_ENV === 'production';

// Valores válidos para sameSite: 'strict', 'lax', 'none' (este último requer secure: true)
const sameSiteValue = isProduction ? 'none' : 'lax';

const csrfProtection = csrf({
  cookie: {
    key: '_csrf',
    secure: isProduction,
    sameSite: sameSiteValue,
    httpOnly: false
  }
});

const csrfErrorHandler = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  
  console.error('Erro de CSRF:', {
    url: req.originalUrl,
    method: req.method,
    headers: req.headers
  });
  
  res.status(403).json({ 
    error: 'Token CSRF inválido',
    code: 'EBADCSRFTOKEN'
  });
};

module.exports = { csrfProtection, csrfErrorHandler };