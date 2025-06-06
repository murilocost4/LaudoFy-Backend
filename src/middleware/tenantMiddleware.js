const jwt = require('jsonwebtoken');

const tenantMiddleware = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // AdminMaster tem acesso completo - bypass tenant check
    if (decoded.isAdminMaster || decoded.role === 'adminMaster') {
      req.user = decoded;
      req.isAdminMaster = true;
      return next();
    }

    // Para outros usuários, verificar tenant_id
    if (!decoded.tenant_id) {
      return res.status(403).json({ erro: 'Tenant não autorizado' });
    }

    // Adicionar informações do usuário e tenant ao request
    req.user = decoded;
    req.tenant_id = decoded.tenant_id;
    
    // Para médicos que podem ter múltiplos tenants
    if (Array.isArray(decoded.tenant_id)) {
      req.tenantFilter = { tenant_id: { $in: decoded.tenant_id } };
    } else {
      req.tenantFilter = { tenant_id: decoded.tenant_id };
    }
    
    next();
  } catch (error) {
    console.error('Erro no middleware de tenant:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ erro: 'Token inválido' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado' });
    }
    
    return res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

module.exports = tenantMiddleware;