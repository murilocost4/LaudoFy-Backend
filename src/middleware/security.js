// middleware/security.js
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Configurações de segurança HTTP
module.exports.secureHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"]
        }
    },
    hsts: {
        maxAge: 63072000, // 2 anos em segundos
        includeSubDomains: true,
        preload: true
    },
    referrerPolicy: { policy: 'same-origin' }
});

// Limitação de taxa para prevenir brute force
/*module.exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100000, // limite de 100000 requisições por IP
    message: 'Too many requests from this IP, please try again later'
});

// Limitação mais rigorosa para endpoints de autenticação
module.exports.authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // limite de 20 tentativas de login por IP
    message: 'Too many login attempts from this IP, please try again later'
});*/