const Usuario = require('../models/Usuario');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');
const AuditLog = require('../models/AuditModel');
const { validationResult } = require('express-validator');

// Listar tenants onde o usuário pode ser admin
exports.listarTenantsDisponiveis = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const usuario = await Usuario.findById(userId).populate('tenant_id', 'nome nomeFantasia');
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está fazendo a consulta tem permissão
    if (!req.usuario.isAdminMaster && req.usuario.id !== userId) {
      return res.status(403).json({ erro: 'Sem permissão para consultar este usuário' });
    }

    const tenantsDisponiveis = usuario.tenant_id.map(tenant => ({
      id: tenant._id,
      nome: tenant.nome,
      nomeFantasia: tenant.nomeFantasia,
      isAdmin: usuario.admin_tenants ? usuario.admin_tenants.includes(tenant._id) : false
    }));

    res.json({
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        email: usuario.email
      },
      tenantsDisponiveis,
      tenantsAdmin: usuario.admin_tenants || []
    });

  } catch (err) {
    logger.error('Erro ao listar tenants disponíveis:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Adicionar usuário como admin de um tenant
exports.adicionarAdminTenant = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erros: errors.array() });
    }

    const { userId } = req.params;
    const { tenantId } = req.body;
    
    const usuario = await Usuario.findById(userId);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está adicionando tem permissão
    if (!req.usuario.isAdminMaster) {
      return res.status(403).json({ erro: 'Apenas AdminMaster pode gerenciar permissões de admin por tenant' });
    }

    // Verificar se o tenant existe
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    // Salvar estado anterior para auditoria
    const estadoAnterior = {
      admin_tenants: [...(usuario.admin_tenants || [])]
    };

    try {
      usuario.adicionarTenantAdmin(tenantId);
      await usuario.save();

      // Log de auditoria
      await AuditLog.create({
        userId: req.usuario.id,
        action: 'update',
        description: `Usuário ${usuario.nome} adicionado como admin do tenant ${tenant.nome}`,
        collectionName: 'usuarios',
        documentId: usuario._id,
        before: estadoAnterior,
        after: {
          admin_tenants: usuario.admin_tenants || []
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: Array.isArray(req.tenant_id) ? req.tenant_id[0] : req.tenant_id
      });

      res.json({
        mensagem: 'Usuário adicionado como admin do tenant com sucesso',
        usuario: {
          id: usuario._id,
          nome: usuario.nome,
          admin_tenants: usuario.admin_tenants,
          tenantsAdmin: usuario.getTenantsAdmin()
        }
      });

    } catch (tenantError) {
      return res.status(400).json({ erro: tenantError.message });
    }

  } catch (err) {
    logger.error('Erro ao adicionar admin tenant:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Remover usuário como admin de um tenant
exports.removerAdminTenant = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ erros: errors.array() });
    }

    const { userId } = req.params;
    const { tenantId } = req.body;
    
    const usuario = await Usuario.findById(userId);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // Verificar se quem está removendo tem permissão
    if (!req.usuario.isAdminMaster) {
      return res.status(403).json({ erro: 'Apenas AdminMaster pode gerenciar permissões de admin por tenant' });
    }

    // Verificar se o tenant existe
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ erro: 'Tenant não encontrado' });
    }

    // Salvar estado anterior para auditoria
    const estadoAnterior = {
      admin_tenants: [...(usuario.admin_tenants || [])]
    };

    usuario.removerTenantAdmin(tenantId);
    await usuario.save();

    // Log de auditoria
    await AuditLog.create({
      userId: req.usuario.id,
      action: 'update',
      description: `Usuário ${usuario.nome} removido como admin do tenant ${tenant.nome}`,
      collectionName: 'usuarios',
      documentId: usuario._id,
      before: estadoAnterior,
      after: {
        admin_tenants: usuario.admin_tenants || []
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      tenant_id: Array.isArray(req.tenant_id) ? req.tenant_id[0] : req.tenant_id
    });

    res.json({
      mensagem: 'Usuário removido como admin do tenant com sucesso',
      usuario: {
        id: usuario._id,
        nome: usuario.nome,
        admin_tenants: usuario.admin_tenants,
        tenantsAdmin: usuario.getTenantsAdmin()
      }
    });

  } catch (err) {
    logger.error('Erro ao remover admin tenant:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Listar usuários que são admins de um tenant específico
exports.listarAdminsPorTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;

    // Verificar se quem está consultando tem permissão
    if (!req.usuario.isAdminMaster && !req.usuario.tenantsAdmin.includes(tenantId)) {
      return res.status(403).json({ erro: 'Sem permissão para consultar este tenant' });
    }

    const admins = await Usuario.find({
      $or: [
        { admin_tenants: tenantId },
        { isAdminMaster: true, tenant_id: tenantId }
      ]
    }).select('nome email role roles admin_tenants isAdminMaster ativo');

    const adminsList = admins.map(admin => ({
      id: admin._id,
      nome: admin.nome,
      email: admin.email,
      rolePrincipal: admin.role,
      rolesAdicionais: admin.roles || [],
      isAdminMaster: admin.isAdminMaster,
      ativo: admin.ativo,
      tipoAdmin: admin.isAdminMaster ? 'AdminMaster' : 'Admin do Tenant'
    }));

    res.json({
      tenantId,
      admins: adminsList,
      total: adminsList.length
    });

  } catch (err) {
    logger.error('Erro ao listar admins por tenant:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// Obter estatísticas de permissões por tenant
exports.getEstatisticasPermissoes = async (req, res) => {
  try {
    // Verificar se é AdminMaster
    if (!req.usuario.isAdminMaster) {
      return res.status(403).json({ erro: 'Apenas AdminMaster pode consultar estatísticas globais' });
    }

    const estatisticas = await Usuario.aggregate([
      {
        $match: {
          admin_tenants: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: '$admin_tenants'
      },
      {
        $group: {
          _id: '$admin_tenants',
          totalAdmins: { $sum: 1 },
          usuarios: {
            $push: {
              id: '$_id',
              nome: '$nome',
              email: '$email'
            }
          }
        }
      },
      {
        $lookup: {
          from: 'tenants',
          localField: '_id',
          foreignField: '_id',
          as: 'tenant'
        }
      },
      {
        $unwind: '$tenant'
      },
      {
        $project: {
          tenantId: '$_id',
          tenantNome: '$tenant.nome',
          tenantNomeFantasia: '$tenant.nomeFantasia',
          totalAdmins: 1,
          usuarios: 1
        }
      }
    ]);

    res.json({
      estatisticas,
      totalTenantsComAdmins: estatisticas.length
    });

  } catch (err) {
    logger.error('Erro ao obter estatísticas de permissões:', err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};
