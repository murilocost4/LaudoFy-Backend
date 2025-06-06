const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file'); // Importe o transport corretamente
const { combine, timestamp, printf, colorize } = winston.format;

// Formato dos logs
const logFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});

// Configuração do logger
const logger = winston.createLogger({
    level: 'info', // Nível mínimo de log
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Formato da data/hora
        logFormat
    ),
    transports: [
        // Logs de nível "error" em um arquivo separado
        new DailyRotateFile({
            level: 'error',
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d', // Mantém logs por 14 dias
        }),
        // Todos os logs em um arquivo geral
        new DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d', // Mantém logs por 14 dias
        }),
        // Exibe logs no console (apenas em desenvolvimento)
        new winston.transports.Console({
            format: combine(colorize(), logFormat),
        }),
    ],
});

// Se estiver em produção, desabilita logs no console
if (process.env.NODE_ENV === 'production') {
    logger.remove(winston.transports.Console);
}

module.exports = logger;