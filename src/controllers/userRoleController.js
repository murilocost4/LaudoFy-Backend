const Usuario = require('../models/Usuario');
const logger = require('../utils/logger');
const AuditLog = require('../models/AuditModel');
const { validationResult } = require('express-validator');

// Obter todas as roles do usuário
exports.obterRolesUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    
    const usuario = await Usuario.findById(id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    const rolesInfo = {
      id: usuario._id,
      nome: usuario.nome,
      email: usuario.email,
      rolePrincipal: usuario.role,
      rolesAdicionais: usuario.roles || [],
      todasRoles: usuario.todasRoles,
      isAdminMaster: usuario.isAdminMaster
    };

    res.json(rolesInfo);
  } catch (err) {
    logger.error('Erro ao obter roles do usuário:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Adicionar role adicional ao usuário
exports.adicionarRole = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erros: errors.array() });
    }

    const { id } = req.params;
    const { role } = req.body;
    
    const usuario = await Usuario.findById(id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está adicionando tem permissão
    if (!req.usuario.isAdminMaster && req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Sem permissão para modificar roles' });
    }

    // Salvar estado anterior para auditoria
    const estadoAnterior = {
      rolePrincipal: usuario.role,
      rolesAdicionais: [...(usuario.roles || [])]
    };

    // Adicionar role
    try {
      usuario.adicionarRole(role);
      await usuario.save();

      // Log de auditoria
      await AuditLog.create({
        userId: req.usuario.id,
        action: 'update',
        description: `Role "${role}" adicionada ao usuário ${usuario.nome}`,
        collectionName: 'usuarios',
        documentId: usuario._id,
        before: estadoAnterior,
        after: {
          rolePrincipal: usuario.role,
          rolesAdicionais: usuario.roles || []
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: Array.isArray(req.tenant_id) ? req.tenant_id[0] : req.tenant_id
      });

      res.json({
        mensagem: 'Role adicionada com sucesso',
        usuario: {
          id: usuario._id,
          nome: usuario.nome,
          rolePrincipal: usuario.role,
          rolesAdicionais: usuario.roles,
          todasRoles: usuario.todasRoles
        }
      });

    } catch (roleError) {
      return res.status(400).json({ erro: roleError.message });
    }

  } catch (err) {
    logger.error('Erro ao adicionar role:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Remover role adicional do usuário
exports.removerRole = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erros: errors.array() });
    }

    const { id } = req.params;
    const { role } = req.body;
    
    const usuario = await Usuario.findById(id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está removendo tem permissão
    if (!req.usuario.isAdminMaster && req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Sem permissão para modificar roles' });
    }

    // Salvar estado anterior para auditoria
    const estadoAnterior = {
      rolePrincipal: usuario.role,
      rolesAdicionais: [...(usuario.roles || [])]
    };

    // Remover role
    try {
      usuario.removerRole(role);
      await usuario.save();

      // Log de auditoria
      await AuditLog.create({
        userId: req.usuario.id,
        action: 'update',
        description: `Role "${role}" removida do usuário ${usuario.nome}`,
        collectionName: 'usuarios',
        documentId: usuario._id,
        before: estadoAnterior,
        after: {
          rolePrincipal: usuario.role,
          rolesAdicionais: usuario.roles || []
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: Array.isArray(req.tenant_id) ? req.tenant_id[0] : req.tenant_id
      });

      res.json({
        mensagem: 'Role removida com sucesso',
        usuario: {
          id: usuario._id,
          nome: usuario.nome,
          rolePrincipal: usuario.role,
          rolesAdicionais: usuario.roles,
          todasRoles: usuario.todasRoles
        }
      });

    } catch (roleError) {
      return res.status(400).json({ erro: roleError.message });
    }

  } catch (err) {
    logger.error('Erro ao remover role:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Alterar role principal do usuário
exports.alterarRolePrincipal = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erros: errors.array() });
    }

    const { id } = req.params;
    const { novaRolePrincipal } = req.body;
    
    const usuario = await Usuario.findById(id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está alterando tem permissão
    if (!req.usuario.isAdminMaster && req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Sem permissão para modificar roles' });
    }

    // Salvar estado anterior para auditoria
    const estadoAnterior = {
      rolePrincipal: usuario.role,
      rolesAdicionais: [...(usuario.roles || [])]
    };

    // Alterar role principal
    const rolesValidas = ['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'];
    if (!rolesValidas.includes(novaRolePrincipal)) {
      return res.status(400).json({ erro: 'Role principal inválida' });
    }

    usuario.role = novaRolePrincipal;
    
    // Se a nova role principal estava nas roles adicionais, remover de lá
    if (usuario.roles && usuario.roles.includes(novaRolePrincipal)) {
      usuario.roles = usuario.roles.filter(role => role !== novaRolePrincipal);
    }

    await usuario.save();

    // Log de auditoria
    await AuditLog.create({
      userId: req.usuario.id,
      action: 'update',
      description: `Role principal alterada de "${estadoAnterior.rolePrincipal}" para "${novaRolePrincipal}" do usuário ${usuario.nome}`,
      collectionName: 'usuarios',
      documentId: usuario._id,
      before: estadoAnterior,
      after: {
        rolePrincipal: usuario.role,
        rolesAdicionais: usuario.roles || []
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      tenant_id: Array.isArray(req.tenant_id) ? req.tenant_id[0] : req.tenant_id
    });

    res.json({
      mensagem: 'Role principal alterada com sucesso',
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        rolePrincipal: usuario.role,
        rolesAdicionais: usuario.roles,
        todasRoles: usuario.todasRoles
      }
    });

  } catch (err) {
    logger.error('Erro ao alterar role principal:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Listar usuários com suas roles
exports.listarUsuariosComRoles = async (req, res) => {
  try {
    // Usar tenantsPermitidos do middleware filtrarPorTenantsAdmin
    const tenantsPermitidos = req.tenantsPermitidos || req.tenant_id;
    
    const usuarios = await Usuario.find({
      tenant_id: { $in: tenantsPermitidos }
    }).select('nome email role roles admin_tenants ativo isAdminMaster');

    const usuariosComRoles = usuarios.map(usuario => ({
      id: usuario._id,
      nome: usuario.nome,
      email: usuario.email,
      rolePrincipal: usuario.role,
      rolesAdicionais: usuario.roles || [],
      todasRoles: usuario.todasRoles,
      adminTenants: usuario.admin_tenants || [],
      tenantsAdmin: usuario.getTenantsAdmin(),
      ativo: usuario.ativo,
      isAdminMaster: usuario.isAdminMaster
    }));

    res.json(usuariosComRoles);
  } catch (err) {
    logger.error('Erro ao listar usuários com roles:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};
