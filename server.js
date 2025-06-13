// DEPENDÊNCIAS
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const xss = require('xss-clean');
const logger = require('./src/config/logger');
const fs = require('fs');
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const sameSiteValue = isProduction ? 'none' : 'lax';

console.log('=== INITIALIZING SERVER ===');

const app = express();
const server = http.createServer(app);

// 🔐 CORS PRIMÁRIO – OBRIGATÓRIO ANTES DE TUDO
const allowedOrigins = [
  'https://laudofy.fytenza.com.br',
  'http://localhost:5173'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CSRF-Skip');
    res.setHeader('Access-Control-Expose-Headers', 'X-CSRF-Token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 🔒 MIDDLEWARE DE SEGURANÇA
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com"],
      connectSrc: ["'self'", "http://localhost:5173", "https://laudofy-backend-production.up.railway.app", "wss:"],
      imgSrc: ["'self'", "data:", "https://www.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(helmet.referrerPolicy({ policy: 'no-referrer' }));
app.use(helmet.permittedCrossDomainPolicies());
app.use(helmet.noSniff());
app.use(helmet.xssFilter());

// ⚙️ COOKIES + JSON
app.use(cookieParser());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// 🔄 ROTA CSRF ANTES DE TUDO (mesmo sem Mongo)
const csrfProtection = csrf({ cookie: true });
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  const token = req.csrfToken();
  res.cookie('XSRF-TOKEN', token, {
    secure: isProduction,
    httpOnly: false,
    sameSite: sameSiteValue,
    path: '/' // sem domain!
  });
  res.json({ csrfToken: token });
});

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 2000, // Limite de 200 requisições por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente mais tarde.' }
}));

// 🌐 CONEXÃO COM O MONGO
mongoose.connect(process.env.MONGO_URI, {
  dbName: 'laudos-medicos',
  serverSelectionTimeoutMS: 20000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  w: 'majority'
})
.then(() => {
  console.log('🟢 MongoDB conectado.');

  if (isProduction) app.set('trust proxy', 1);

  // 💾 SESSÃO
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 14 * 24 * 60 * 60
    }),
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: sameSiteValue,
      domain: undefined,
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  }));

  // 🔒 PROTEÇÃO CSRF COM EXCEÇÕES
  const fullCsrfProtection = csrf({
    cookie: {
      key: '_csrf',
      secure: isProduction,
      httpOnly: true,
      sameSite: sameSiteValue,
      maxAge: 3600000 // 1 hora em milissegundos
    }
  });

  const csrfBypass = [
    '/api/csrf-token',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/refresh-token',
    '/health',
    '/api/test'
  ];

  app.use((req, res, next) => {
    if (csrfBypass.some(path => req.path.startsWith(path))) return next();
    return fullCsrfProtection(req, res, next);
  });

  // ✅ ROTAS
  const authMiddleware = require('./src/middleware/authMiddleware');
  app.use('/api/auth', require('./src/routes/authRoutes'));
  app.use('/api/exames', authMiddleware, require('./src/routes/exameRoutes'));
  app.use('/api/laudos', authMiddleware, require('./src/routes/laudoRoutes'));
  app.use('/api/pacientes', authMiddleware, require('./src/routes/pacienteRoutes'));
  app.use('/api/usuarios', authMiddleware, require('./src/routes/usuarioRoutes'));
  app.use('/api/user-roles', authMiddleware, require('./src/routes/userRoleRoutes'));
  app.use('/api/tenant-admin', authMiddleware, require('./src/routes/tenantAdminRoutes'));
  app.use('/api/estatisticas', authMiddleware, require('./src/routes/estatisticaRoutes'));
  app.use('/api/financeiro', authMiddleware, require('./src/routes/valorLaudoRoutes'));
  app.use('/api/financeiro', authMiddleware, require('./src/routes/financeiroRoutes'));
  app.use('/api/auditoria', authMiddleware, require('./src/routes/auditLogRoutes'));
  app.use('/api/tenants', authMiddleware, require('./src/routes/tenantRoutes'));
  app.use('/api/especialidades', authMiddleware, require('./src/routes/especialidadeRoutes'));
  app.use('/api/papeis', authMiddleware, require('./src/routes/papelRoutes'));
  app.use('/api/tipos-exame', authMiddleware, require('./src/routes/tipoExameRoutes'));
  app.use('/api/admin', authMiddleware, require('./src/routes/adminRoutes'));
  app.use('/api/valor-laudo', authMiddleware, require('./src/routes/valorLaudoRoutes'));
  app.use('/api/dashboard', authMiddleware, require('./src/routes/dashboardRoutes'));
  app.use('/api/certificados', require('./src/routes/certificadoDigitalRoutes'));

  app.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      dbState: mongoose.STATES[mongoose.connection.readyState],
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    });
  });

  app.get('/api/test', (req, res) => {
    res.json({
      status: 'ok',
      cookies: req.cookies,
      headers: req.headers
    });
  });

  // 📡 SOCKET.IO
  const io = socketIo(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('📡 Socket conectado:', socket.id);
    socket.on('novoExame', (data) => io.emit('exameCriado', data));
    socket.on('laudoConcluido', (data) => io.emit('laudoFinalizado', data));
    socket.on('disconnect', () => console.log('Socket desconectado:', socket.id));
  });
  io.on('connect_error', (err) => console.error('Erro de conexão Socket:', err.message));


  // DEV ONLY: CRIAR PASTAS
  if (!isProduction) {
    ['laudos', 'laudos/assinados', 'uploads', 'uploads/thumbnails'].forEach(dir => {
      const fullPath = path.join(__dirname, dir);
      if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    });
  }

  // 🚀 START SERVER
  server.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Servidor rodando na porta ${process.env.PORT || 3000}`);
  });
})
.catch(err => {
  console.error('❌ Falha na conexão com o MongoDB:', err.message, err);
  process.exit(1);
});

// 🔥 ERROS GLOBAIS
app.use((err, req, res, next) => {
  console.error('❌ Erro global:', err);

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'Invalid CSRF token',
      code: 'EBADCSRFTOKEN'
    });
  }

  res.status(500).json({ error: 'Erro interno no servidor' });
});
