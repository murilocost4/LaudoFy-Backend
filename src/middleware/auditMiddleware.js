const AuditLog = require('../models/AuditModel');

const auditLog = (action, description, options = {}) => {
    return async (req, res, next) => {
        const startTime = Date.now();
        
        // Captura o estado anterior para operações de update
        let beforeState = null;
        if (action === 'update' && options.captureBefore) {
            try {
                const model = mongoose.model(req.baseUrl.replace('/', ''));
                beforeState = await model.findById(req.params.id).lean();
            } catch (error) {
                console.error('Error capturing before state:', error);
            }
        }

        // Função para registrar o log
        const registerLog = async (error = null) => {
            try {
                const logData = {
                    userId: req.user?._id || null,
                    action: error ? 'failed_' + action : action,
                    description: error ? `${description} (Failed: ${error.message})` : description,
                    collectionName: req.baseUrl.replace('/', '') || 'auth',
                    documentId: req.params.id || null,
                    before: beforeState,
                    after: error ? null : (req.body || null),
                    ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                    userAgent: req.headers['user-agent'] || '',
                    timestamp: new Date(),
                    responseTime: Date.now() - startTime,
                    status: error ? 'failed' : 'success'
                };

                await AuditLog.create(logData);
            } catch (logError) {
                console.error('Failed to save audit log:', logError);
            }
        };

        try {
            // Executa a rota
            await next();
            
            // Registra log de sucesso
            if (!res.headersSent) {
                await registerLog();
            }
        } catch (error) {
            // Registra log de erro
            await registerLog(error);
            throw error; // Propaga o erro para o próximo middleware de erro
        }
    };
};

module.exports = { auditLog };