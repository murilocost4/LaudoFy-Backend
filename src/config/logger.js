const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors } = format;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Defina o diretório de logs (usando path.join para compatibilidade entre sistemas)
const logDir = path.join(__dirname, '../../logs');

// Formato personalizado para os logs
const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Crie o logger principal
const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }), // Mostra stack traces quando disponível
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.json()
  ),
  transports: [
    // Console transport (para desenvolvimento)
    new transports.Console({
      format: combine(
        colorize(),
        logFormat
      )
    }),
    // Arquivo de log diário para todos os logs
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: combine(logFormat)
    }),
    // Arquivo separado para erros
    new DailyRotateFile({
      level: 'error',
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d'
    })
  ],
  exceptionHandlers: [
    new transports.File({ 
      filename: path.join(logDir, 'exceptions.log') 
    })
  ],
  rejectionHandlers: [
    new transports.File({ 
      filename: path.join(logDir, 'rejections.log') 
    })
  ]
});

// Stream para o morgan (middleware de HTTP logging)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Função para log de requisições HTTP
logger.logRequest = (req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    headers: req.headers,
    body: req.body
  });
  next();
};

// Função para log de erros
logger.logError = (error, req = null) => {
  let context = {};
  
  if (req) {
    context = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      user: req.user ? req.user.id : 'guest'
    };
  }

  logger.error(error.message, { 
    stack: error.stack,
    ...context 
  });
};

module.exports = logger;