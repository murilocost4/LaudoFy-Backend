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
        
        // Handle tenant ID as array in request
        if (typeof requestTenantId === 'string' && requestTenantId.startsWith('[') && requestTenantId.endsWith(']')) {
            try {
                requestTenantId = JSON.parse(requestTenantId)[0];
            } catch (e) {
                console.error('Error parsing tenant_id array from string:', e);
            }
        }
        
        // Add debug logs
        console.log('Req usuario:', req.usuario);
        console.log('Tenant ID from query (processed):', requestTenantId);
        console.log('Tenant ID from usuario (processed):', userTenantId);

        // AdminMaster pode acessar qualquer tenant
        if (req.usuario.isAdminMaster) {
            return next();
        }

        // For non-AdminMaster users, use their tenant_id
        req.query.tenantId = userTenantId;
        
        // Continue processing
        next();
    } catch (error) {
        console.error('Error in verificarAcessoTenant middleware:', error);
        next(); // Allow the request to continue and let the controller handle errors
    }
};

module.exports = { autorizacaoMiddleware, verificarAcessoTenant };