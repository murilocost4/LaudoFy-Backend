const autorizacaoMiddleware = (rolesPermitidos) => (req, res, next) => {
    const usuarioRole = req.usuario.role;

    if (req.usuario.isAdminMaster || rolesPermitidos.includes(usuarioRole)) {
        return next();
    }

        return res.status(403).json({ erro: 'Acesso negado' });
};

const verificarAcessoTenant = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json({ erro: 'Usuário não autenticado' });
    }

    try {
        // Handle tenant_id as array in usuario
        let userTenantId = req.usuario.tenant_id;
        if (Array.isArray(userTenantId)) {
            userTenantId = userTenantId[0];
        }
        
        // Get tenant ID from query or body
        let requestTenantId = req.query.tenantId || req.body.tenantId;
        
        // Handle case where tenant_id is passed as an object with properties
        // This happens when frontend sends an object instead of just the ID
        if (req.query['tenant_id[_id]']) {
            // Extract the _id from the object structure
            requestTenantId = req.query['tenant_id[_id]'];
            console.log('DEBUG: Extracted tenant_id from object structure:', requestTenantId);
        }
        
        // Debug log to understand the data structure
        if (requestTenantId && typeof requestTenantId === 'string' && (requestTenantId.startsWith('[') || requestTenantId.includes('ObjectId'))) {
            console.log('DEBUG: Processing tenant_id string:', requestTenantId);
        }
        
        // Handle tenant ID as array in request
        if (typeof requestTenantId === 'string' && requestTenantId.startsWith('[') && requestTenantId.endsWith(']')) {
            try {
                const parsed = JSON.parse(requestTenantId);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    requestTenantId = parsed[0];
                    console.log('DEBUG: Successfully parsed tenant_id array, using:', requestTenantId);
                } else {
                    console.error('Parsed tenant_id is not a valid array:', requestTenantId);
                    requestTenantId = null;
                }
            } catch (e) {
                console.error('Error parsing tenant_id array from string:', requestTenantId, e.message);
                requestTenantId = null;
            }
        }

        // AdminMaster pode acessar qualquer tenant
        if (req.usuario.isAdminMaster) {
            return next();
        }

        // For non-AdminMaster users, use their tenant_id
        req.query.tenantId = userTenantId;
        
        // Continue processing
        next();
    } catch (error) {
        console.error('Error in verificarAcessoTenant middleware');
        next(); // Allow the request to continue and let the controller handle errors
    }
};

module.exports = { autorizacaoMiddleware, verificarAcessoTenant };