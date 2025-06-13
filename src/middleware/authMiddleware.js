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
      _id: decoded.id, // Adicionar _id para compatibilidade
      nome: decoded.nome, // **Nome descriptografado do token**
      role: decoded.role,
      roles: decoded.roles || [], // Roles adicionais
      todasRoles: decoded.todasRoles || [decoded.role], // Todas as roles
      isAdminMaster: decoded.isAdminMaster || false,
      permissaoFinanceiro: decoded.permissaoFinanceiro || false,
      tenant_id: tenantIds,
      admin_tenants: decoded.admin_tenants || [], // Tenants onde é admin
      tenantsAdmin: decoded.tenantsAdmin || [], // Virtual para tenants admin
      especialidades: decoded.especialidades || [],
      ativo: decoded.ativo !== false // **Default para true se não definido**
    };

    req.usuarioNome = decoded.nome; // **Nome descriptografado**
    req.tenant_id = tenantIds;
    req.papeis = decoded.papeis;
    req.especialidades = decoded.especialidades;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
};

module.exports = authMiddleware;

// Exportar as funções auxiliares
module.exports.verificarRole = (rolesPermitidos) => {
  return (req, res, next) => {
    // Converter para array se não for
    if (!Array.isArray(rolesPermitidos)) {
      rolesPermitidos = [rolesPermitidos];
    }
    
    // Verificar se o usuário tem pelo menos uma das roles permitidas
    const temPermissao = rolesPermitidos.some(rolePermitida => {
      // Verificar role principal
      if (req.usuario.role === rolePermitida) return true;
      
      // Verificar roles adicionais
      if (req.usuario.roles && req.usuario.roles.includes(rolePermitida)) return true;
      
      // Verificar todas as roles (incluindo AdminMaster)
      if (req.usuario.todasRoles && req.usuario.todasRoles.includes(rolePermitida)) return true;
      
      return false;
    });
    
    if (!temPermissao) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    next();
  };
};

// Novo middleware para verificar se tem role específica
module.exports.verificarRoleEspecifica = (roleEspecifica) => {
  return (req, res, next) => {
    const todasRoles = req.usuario.todasRoles || [req.usuario.role];
    
    if (!todasRoles.includes(roleEspecifica)) {
      return res.status(403).json({ erro: `Acesso negado. Role '${roleEspecifica}' necessária.` });
    }
    next();
  };
};

// Middleware para verificar se tem TODAS as roles especificadas
module.exports.verificarTodasRoles = (rolesNecessarias) => {
  return (req, res, next) => {
    if (!Array.isArray(rolesNecessarias)) {
      rolesNecessarias = [rolesNecessarias];
    }
    
    const todasRoles = req.usuario.todasRoles || [req.usuario.role];
    const temTodasRoles = rolesNecessarias.every(role => todasRoles.includes(role));
    
    if (!temTodasRoles) {
      return res.status(403).json({ erro: `Acesso negado. Roles necessárias: ${rolesNecessarias.join(', ')}` });
    }
    next();
  };
};

// Middleware para verificar se o usuário é admin de um tenant específico
module.exports.verificarAdminTenant = (req, res, next) => {
  try {
    const tenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID é obrigatório' });
    }

    // AdminMaster tem acesso a tudo
    if (req.usuario.isAdminMaster) {
      return next();
    }

    // Verificar se o usuário tem role de admin
    const todasRoles = req.usuario.todasRoles || [req.usuario.role];
    if (!todasRoles.includes('admin')) {
      return res.status(403).json({ erro: 'Acesso negado. Role de admin necessária.' });
    }

    // Verificar se o usuário é admin deste tenant específico
    const adminTenants = req.usuario.admin_tenants || [];
    const isAdminDoTenant = adminTenants.some(adminTenant => 
      adminTenant.toString() === tenantId.toString()
    );

    if (!isAdminDoTenant) {
      return res.status(403).json({ erro: 'Acesso negado. Você não é admin deste tenant.' });
    }

    next();
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao verificar permissões de tenant' });
  }
};

// Middleware para filtrar dados baseado nos tenants que o usuário administra
module.exports.filtrarPorTenantsAdmin = (req, res, next) => {
  try {
    // AdminMaster tem acesso a todos os tenants
    if (req.usuario.isAdminMaster) {
      req.tenantsPermitidos = req.tenant_id;
      return next();
    }

    // Para usuários com role admin, filtrar pelos tenants que administram
    const todasRoles = req.usuario.todasRoles || [req.usuario.role];
    if (todasRoles.includes('admin')) {
      const adminTenants = req.usuario.admin_tenants || [];
      req.tenantsPermitidos = adminTenants;
    } else {
      // Para outros usuários, usar todos os tenants que têm acesso
      req.tenantsPermitidos = req.tenant_id;
    }

    next();
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao filtrar tenants' });
  }
};
