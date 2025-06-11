const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditModel');
const mongoose = require('mongoose');
const { decrypt } = require('../utils/crypto');

// Listar tenants - SEM AUDITORIA (consulta simples)
exports.listarTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find()
      .select('-senhaHash -secretKeys') // Excluir dados sensíveis
      .sort({ nomeFantasia: 1 });
    
    res.status(200).json(tenants);
  } catch (err) {
    console.error('Erro ao listar tenants');
    res.status(500).json({ 
      error: 'Erro ao listar tenants',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Criar tenant - APENAS SUCESSO
exports.criarTenant = async (req, res) => {
  try {
    const {
      nomeFantasia,
      razaoSocial,
      cnpj,
      email,
      telefone,
      endereco,
      status,
      configuracoes
    } = req.body;

    // Verificar se já existe tenant com mesmo CNPJ
    if (cnpj) {
      const tenantExistente = await Tenant.findOne({ cnpj });
      if (tenantExistente) {
        return res.status(400).json({ error: 'Já existe um tenant com este CNPJ' });
      }
    }

    // Verificar se já existe tenant com mesmo email
    if (email) {
      const tenantExistenteEmail = await Tenant.findOne({ email });
      if (tenantExistenteEmail) {
        return res.status(400).json({ error: 'Já existe um tenant com este email' });
      }
    }

    const tenant = new Tenant(req.body);
    await tenant.save();

    // **LOG DE SUCESSO DA CRIAÇÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'create',
        description: `Novo tenant criado: ${nomeFantasia} (${cnpj || 'CNPJ não informado'})`,
        collectionName: 'tenants',
        documentId: tenant._id,
        before: null,
        after: {
          id: tenant._id,
          nomeFantasia: tenant.nomeFantasia,
          razaoSocial: tenant.razaoSocial,
          cnpj: tenant.cnpj,
          email: tenant.email,
          status: tenant.status
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: tenant._id // O próprio tenant criado
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    // Remover dados sensíveis da resposta
    const tenantResponse = tenant.toObject();
    delete tenantResponse.senhaHash;
    delete tenantResponse.secretKeys;

    res.status(201).json({
      success: true,
      message: 'Tenant criado com sucesso',
      tenant: tenantResponse
    });
  } catch (err) {
    console.error('Erro ao criar tenant');
    res.status(400).json({ 
      error: 'Erro ao criar tenant',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Atualizar tenant - APENAS SUCESSO
exports.atualizarTenant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tenant inválido' });
    }

    // Buscar tenant original
    const tenantOriginal = await Tenant.findById(id);
    if (!tenantOriginal) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    // Verificar duplicatas se CNPJ estiver sendo alterado
    if (req.body.cnpj && req.body.cnpj !== tenantOriginal.cnpj) {
      const tenantExistente = await Tenant.findOne({ 
        cnpj: req.body.cnpj, 
        _id: { $ne: id } 
      });
      if (tenantExistente) {
        return res.status(400).json({ error: 'Já existe um tenant com este CNPJ' });
      }
    }

    // Verificar duplicatas se email estiver sendo alterado
    if (req.body.email && req.body.email !== tenantOriginal.email) {
      const tenantExistenteEmail = await Tenant.findOne({ 
        email: req.body.email, 
        _id: { $ne: id } 
      });
      if (tenantExistenteEmail) {
        return res.status(400).json({ error: 'Já existe um tenant com este email' });
      }
    }

    // Dados antes da atualização
    const dadosAntes = {
      nomeFantasia: tenantOriginal.nomeFantasia,
      razaoSocial: tenantOriginal.razaoSocial,
      cnpj: tenantOriginal.cnpj,
      email: tenantOriginal.email,
      status: tenantOriginal.status,
      telefone: tenantOriginal.telefone
    };

    // Atualizar tenant
    const tenant = await Tenant.findByIdAndUpdate(
      id, 
      req.body, 
      { new: true, runValidators: true }
    );

    // **LOG DE SUCESSO DA ATUALIZAÇÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'update',
        description: `Tenant atualizado: ${tenant.nomeFantasia}`,
        collectionName: 'tenants',
        documentId: tenant._id,
        before: dadosAntes,
        after: {
          nomeFantasia: tenant.nomeFantasia,
          razaoSocial: tenant.razaoSocial,
          cnpj: tenant.cnpj,
          email: tenant.email,
          status: tenant.status,
          telefone: tenant.telefone
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id || tenant._id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    // Remover dados sensíveis da resposta
    const tenantResponse = tenant.toObject();
    delete tenantResponse.senhaHash;
    delete tenantResponse.secretKeys;

    res.status(200).json({
      success: true,
      message: 'Tenant atualizado com sucesso',
      tenant: tenantResponse
    });
  } catch (err) {
    console.error('Erro ao atualizar tenant');
    res.status(400).json({ 
      error: 'Erro ao atualizar tenant',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Deletar tenant - APENAS SUCESSO
exports.deletarTenant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tenant inválido' });
    }

    // Buscar tenant antes de deletar
    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    // Verificar se existem usuários vinculados ao tenant
    const Usuario = require('../models/Usuario');
    const usuariosVinculados = await Usuario.countDocuments({ tenant_id: id });
    
    if (usuariosVinculados > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir tenant que possui usuários vinculados',
        detalhes: `${usuariosVinculados} usuário(s) vinculado(s)`
      });
    }

    // Verificar se existem exames vinculados ao tenant
    const Exame = require('../models/Exame');
    const examesVinculados = await Exame.countDocuments({ tenant_id: id });
    
    if (examesVinculados > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir tenant que possui exames vinculados',
        detalhes: `${examesVinculados} exame(s) vinculado(s)`
      });
    }

    // Dados antes da exclusão
    const dadosAntes = {
      nomeFantasia: tenant.nomeFantasia,
      razaoSocial: tenant.razaoSocial,
      cnpj: tenant.cnpj,
      email: tenant.email,
      status: tenant.status
    };

    // Deletar tenant
    await Tenant.findByIdAndDelete(id);

    // **LOG DE SUCESSO DA EXCLUSÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'delete',
        description: `Tenant excluído: ${tenant.nomeFantasia} (${tenant.cnpj || 'CNPJ não informado'})`,
        collectionName: 'tenants',
        documentId: id,
        before: dadosAntes,
        after: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id || id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(200).json({ 
      success: true,
      message: 'Tenant deletado com sucesso' 
    });
  } catch (err) {
    console.error('Erro ao deletar tenant');
    res.status(500).json({ 
      error: 'Erro ao deletar tenant',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Obter tenant por ID - SEM AUDITORIA (consulta simples)
exports.obterTenantPorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tenant inválido' });
    }

    const tenant = await Tenant.findById(id)
      .select('-senhaHash -secretKeys') // Excluir dados sensíveis
      .lean();

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    res.status(200).json({
      success: true,
      tenant
    });
  } catch (err) {
    console.error('Erro ao buscar tenant');
    res.status(500).json({ 
      error: 'Erro ao buscar tenant',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Obter estatísticas do tenant - LOG DE VISUALIZAÇÃO OPCIONAL
exports.obterEstatisticasTenant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tenant inválido' });
    }

    const tenant = await Tenant.findById(id);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    // Buscar estatísticas do tenant
    const [
      totalUsuarios,
      totalExames,
      totalLaudos,
      totalPacientes
    ] = await Promise.all([
      require('../models/Usuario').countDocuments({ tenant_id: id }),
      require('../models/Exame').countDocuments({ tenant_id: id }),
      require('../models/Laudo').countDocuments({ tenant_id: id }),
      require('../models/Paciente').countDocuments({ tenant_id: id })
    ]);

    // Estatísticas por status de exames
    const examePorStatus = await require('../models/Exame').aggregate([
      { $match: { tenant_id: mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', total: { $sum: 1 } } }
    ]);

    const estatisticas = {
      tenant: {
        id: tenant._id,
        nomeFantasia: tenant.nomeFantasia,
        status: tenant.status
      },
      totais: {
        usuarios: totalUsuarios,
        exames: totalExames,
        laudos: totalLaudos,
        pacientes: totalPacientes
      },
      examePorStatus: examePorStatus.reduce((acc, item) => {
        acc[item._id] = item.total;
        return acc;
      }, {})
    };

    // **LOG DE VISUALIZAÇÃO OPCIONAL**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.usuario._id,
          action: 'view',
          description: `Consultou estatísticas do tenant: ${tenant.nomeFantasia}`,
          collectionName: 'tenants',
          documentId: tenant._id,
          before: null,
          after: estatisticas,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: req.tenant_id || id
        });
      } catch (auditError) {
        console.error('Erro ao criar log de auditoria');
      }
    }

    res.json({
      success: true,
      estatisticas
    });
  } catch (err) {
    console.error('Erro ao obter estatísticas do tenant');
    res.status(500).json({ 
      error: 'Erro ao obter estatísticas',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Ativar/Desativar tenant - APENAS SUCESSO
exports.alterarStatusTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tenant inválido' });
    }

    if (!['ativo', 'inativo', 'suspenso'].includes(status)) {
      return res.status(400).json({ 
        error: 'Status inválido. Use: ativo, inativo ou suspenso' 
      });
    }

    // Buscar tenant atual
    const tenantOriginal = await Tenant.findById(id);
    if (!tenantOriginal) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const statusAnterior = tenantOriginal.status;

    // Atualizar status
    const tenant = await Tenant.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    // **LOG DE SUCESSO DA ALTERAÇÃO DE STATUS**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'update',
        description: `Status do tenant alterado: ${tenant.nomeFantasia} - ${statusAnterior} → ${status}`,
        collectionName: 'tenants',
        documentId: tenant._id,
        before: { status: statusAnterior },
        after: { status: status },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id || tenant._id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      success: true,
      message: `Status do tenant alterado para ${status}`,
      tenant: {
        id: tenant._id,
        nomeFantasia: tenant.nomeFantasia,
        status: tenant.status
      }
    });
  } catch (err) {
    console.error('Erro ao alterar status do tenant');
    res.status(500).json({ 
      error: 'Erro ao alterar status do tenant',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Buscar tenants ativos - SEM AUDITORIA (consulta simples)
exports.listarTenantsAtivos = async (req, res) => {
  try {
    const tenants = await Tenant.find({ 
      status: 'ativo' 
    })
    .select('nomeFantasia razaoSocial cnpj email status')
    .sort({ nomeFantasia: 1 });
    
    res.status(200).json({
      success: true,
      tenants
    });
  } catch (err) {
    console.error('Erro ao listar tenants ativos');
    res.status(500).json({ 
      error: 'Erro ao listar tenants ativos',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
