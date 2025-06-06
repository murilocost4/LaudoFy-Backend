const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ erro: 'Token mal formatado' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificação adicional do token
    if (!decoded.id || !decoded.role) {
      return res.status(401).json({ erro: 'Token inválido' });
    }

    console.log('Token decodificado no authMiddleware:', {
      id: decoded.id,
      nome: decoded.nome, // **Nome já deve estar descriptografado**
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      especialidades: decoded.especialidades
    });

    // **CORRIGIDO: Extrair apenas os IDs dos tenants**
    let tenantIds = decoded.tenant_id;
    if (Array.isArray(tenantIds)) {
      tenantIds = tenantIds.map(tenant => 
        typeof tenant === 'object' && tenant._id ? tenant._id : tenant
      );
    } else if (typeof tenantIds === 'object' && tenantIds._id) {
      tenantIds = tenantIds._id;
    }

    // Add tenant_id and especialidades to the usuario object
    req.usuario = {
      id: decoded.id,
      nome: decoded.nome, // **Nome descriptografado do token**
      role: decoded.role,
      isAdminMaster: decoded.isAdminMaster || false,
      tenant_id: tenantIds,
      especialidades: decoded.especialidades || []
    };

    req.usuarioNome = decoded.nome; // **Nome descriptografado**
    req.tenant_id = tenantIds;
    req.papeis = decoded.papeis;
    req.especialidades = decoded.especialidades;

    console.log('Dados do usuário no req.usuario (CORRIGIDO):', req.usuario);

    next();
  } catch (err) {
    console.error('Erro JWT:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
};

// Middleware de autorização por role
exports.verificarRole = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario.role)) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    next();
  };
};

module.exports = authMiddleware;
