const mongoose = require('mongoose');
const TipoExame = require('../models/TipoExame');
const Especialidade = require('../models/Especialidade');
const AuditLog = require('../models/AuditModel');

// Listar tipos de exame - SEM AUDITORIA (consulta)
exports.listarTiposExame = async (req, res) => {
  try {
    const { especialidadeId, urgente } = req.query;
    
    let query = {};
    
    // **NOVO: Se for médico, filtrar apenas tipos de suas especialidades**
    if (req.usuario.role === 'medico' && req.usuario.especialidades && req.usuario.especialidades.length > 0) {
      query.especialidades = { $in: req.usuario.especialidades };
    } else if (especialidadeId) {
      query.especialidades = especialidadeId;
    }
    
    if (urgente !== undefined) {
      query.urgente = urgente === 'true';
    }

    // Ordenar por urgência primeiro, depois por nome
    const tiposExame = await TipoExame.find(query)
      .populate('especialidades', 'nome')
      .sort({ urgente: -1, nome: 1 });
      
    res.status(200).json(tiposExame);
  } catch (err) {
    console.error('Erro ao listar tipos de exame');
    res.status(500).json({ error: 'Erro ao listar tipos de exame' });
  }
};

// Criar tipo de exame - APENAS SUCESSO
exports.criarTipoExame = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Verifica se as especialidades existem
    if (!req.body.especialidades || !req.body.especialidades.length) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'É necessário informar ao menos uma especialidade' });
    }

    const especialidadesExistem = await Especialidade.find({
      _id: { $in: req.body.especialidades }
    });

    if (especialidadesExistem.length !== req.body.especialidades.length) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Uma ou mais especialidades não existem' });
    }

    // Verificar se já existe tipo de exame com o mesmo nome
    const tipoExameExistente = await TipoExame.findOne({ nome: req.body.nome });
    if (tipoExameExistente) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Já existe um tipo de exame com este nome' });
    }

    // Validar campo urgente
    const dadosTipoExame = {
      ...req.body,
      urgente: req.body.urgente === true || req.body.urgente === 'true'
    };

    // Cria o tipo de exame
    const tipoExame = new TipoExame(dadosTipoExame);
    await tipoExame.save({ session });

    // Atualiza cada especialidade com o novo tipo de exame
    await Promise.all(req.body.especialidades.map(async (espId) => {
      await Especialidade.findByIdAndUpdate(
        espId,
        { $addToSet: { tiposExame: tipoExame._id } },
        { session }
      );
    }));

    await session.commitTransaction();
    
    // Retorna o tipo de exame populado com as especialidades
    const tipoExamePopulado = await TipoExame.findById(tipoExame._id)
      .populate('especialidades', 'nome');

    // **LOG DE SUCESSO DA CRIAÇÃO**
    try {
      const especialidadesNomes = especialidadesExistem.map(esp => esp.nome).join(', ');
      
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'create',
        description: `Novo tipo de exame criado: ${tipoExame.nome} - Especialidades: ${especialidadesNomes}${tipoExame.urgente ? ' (URGENTE)' : ''}`,
        collectionName: 'tipoexames',
        documentId: tipoExame._id,
        before: null,
        after: {
          id: tipoExame._id,
          nome: tipoExame.nome,
          urgente: tipoExame.urgente,
          especialidades: especialidadesNomes,
          status: tipoExame.status || 'ativo'
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }
    
    res.status(201).json({
      success: true,
      message: 'Tipo de exame criado com sucesso',
      tipoExame: tipoExamePopulado
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('Erro ao criar tipo de exame');
    res.status(400).json({ error: 'Erro ao criar tipo de exame' });
  } finally {
    session.endSession();
  }
};

// Atualizar tipo de exame - APENAS SUCESSO
exports.atualizarTipoExame = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tipoExameAntigo = await TipoExame.findById(req.params.id)
      .populate('especialidades', 'nome');
      
    if (!tipoExameAntigo) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    }

    // Verificar se já existe outro tipo de exame com o mesmo nome
    if (req.body.nome && req.body.nome !== tipoExameAntigo.nome) {
      const tipoExameExistente = await TipoExame.findOne({ 
        nome: req.body.nome, 
        _id: { $ne: req.params.id } 
      });
      if (tipoExameExistente) {
        await session.abortTransaction();
        return res.status(400).json({ error: 'Já existe um tipo de exame com este nome' });
      }
    }

    // Dados antes da atualização para auditoria
    const dadosAntes = {
      nome: tipoExameAntigo.nome,
      urgente: tipoExameAntigo.urgente,
      especialidades: tipoExameAntigo.especialidades.map(esp => esp.nome).join(', '),
      status: tipoExameAntigo.status
    };

    // Remove o tipo de exame das especialidades antigas
    await Especialidade.updateMany(
      { _id: { $in: tipoExameAntigo.especialidades } },
      { $pull: { tiposExame: tipoExameAntigo._id } },
      { session }
    );

    // Preparar dados de atualização
    const dadosAtualizacao = {
      ...req.body,
      urgente: req.body.urgente === true || req.body.urgente === 'true'
    };

    // Atualiza o tipo de exame
    const tipoExameAtualizado = await TipoExame.findByIdAndUpdate(
      req.params.id,
      dadosAtualizacao,
      { new: true, session }
    );

    // Buscar nomes das novas especialidades para auditoria
    let novasEspecialidadesNomes = '';
    if (req.body.especialidades && req.body.especialidades.length > 0) {
      const novasEspecialidades = await Especialidade.find({
        _id: { $in: req.body.especialidades }
      });
      novasEspecialidadesNomes = novasEspecialidades.map(esp => esp.nome).join(', ');

      // Adiciona o tipo de exame às novas especialidades
      await Especialidade.updateMany(
        { _id: { $in: req.body.especialidades } },
        { $addToSet: { tiposExame: tipoExameAtualizado._id } },
        { session }
      );
    }

    await session.commitTransaction();

    // Retorna o tipo de exame atualizado e populado
    const tipoExamePopulado = await TipoExame.findById(tipoExameAtualizado._id)
      .populate('especialidades', 'nome');

    // **LOG DE SUCESSO DA ATUALIZAÇÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'update',
        description: `Tipo de exame atualizado: ${tipoExameAtualizado.nome}${tipoExameAtualizado.urgente ? ' (URGENTE)' : ''}`,
        collectionName: 'tipoexames',
        documentId: tipoExameAtualizado._id,
        before: dadosAntes,
        after: {
          nome: tipoExameAtualizado.nome,
          urgente: tipoExameAtualizado.urgente,
          especialidades: novasEspecialidadesNomes || dadosAntes.especialidades,
          status: tipoExameAtualizado.status
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(200).json({
      success: true,
      message: 'Tipo de exame atualizado com sucesso',
      tipoExame: tipoExamePopulado
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('Erro ao atualizar tipo de exame');
    res.status(400).json({ error: 'Erro ao atualizar tipo de exame' });
  } finally {
    session.endSession();
  }
};

// Deletar tipo de exame - APENAS SUCESSO
exports.deletarTipoExame = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const tipoExame = await TipoExame.findById(req.params.id)
      .populate('especialidades', 'nome');
      
    if (!tipoExame) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    }

    // Verificar se existem exames usando este tipo
    const Exame = require('../models/Exame');
    const examesVinculados = await Exame.countDocuments({ tipoExame: req.params.id });
    
    if (examesVinculados > 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        error: 'Não é possível excluir tipo de exame que possui exames vinculados',
        detalhes: `${examesVinculados} exame(s) vinculado(s)`
      });
    }

    // Dados antes da exclusão
    const dadosAntes = {
      nome: tipoExame.nome,
      urgente: tipoExame.urgente,
      especialidades: tipoExame.especialidades.map(esp => esp.nome).join(', '),
      status: tipoExame.status
    };

    // Remove o tipo de exame das especialidades
    await Especialidade.updateMany(
      { _id: { $in: tipoExame.especialidades } },
      { $pull: { tiposExame: tipoExame._id } },
      { session }
    );

    // Remove o tipo de exame
    await TipoExame.findByIdAndDelete(req.params.id, { session });

    await session.commitTransaction();

    // **LOG DE SUCESSO DA EXCLUSÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'delete',
        description: `Tipo de exame excluído: ${tipoExame.nome} - Especialidades: ${dadosAntes.especialidades}`,
        collectionName: 'tipoexames',
        documentId: req.params.id,
        before: dadosAntes,
        after: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(200).json({ 
      success: true,
      message: 'Tipo de exame deletado com sucesso' 
    });
  } catch (err) {
    await session.abortTransaction();
    console.error('Erro ao deletar tipo de exame');
    res.status(500).json({ error: 'Erro ao deletar tipo de exame' });
  } finally {
    session.endSession();
  }
};

// Obter tipo de exame por ID - SEM AUDITORIA (consulta simples)
exports.obterTipoExamePorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tipo de exame inválido' });
    }

    const tipoExame = await TipoExame.findById(id)
      .populate('especialidades', 'nome descricao')
      .lean();

    if (!tipoExame) {
      return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    }

    res.status(200).json({
      success: true,
      tipoExame
    });
  } catch (err) {
    console.error('Erro ao buscar tipo de exame');
    res.status(500).json({ 
      error: 'Erro ao buscar tipo de exame',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Listar tipos urgentes - SEM AUDITORIA (consulta simples)
exports.listarTiposUrgentes = async (req, res) => {
  try {
    let query = { urgente: true, status: 'ativo' };
    
    // Se for médico, filtrar apenas tipos de suas especialidades
    if (req.usuario.role === 'medico' && req.usuario.especialidades && req.usuario.especialidades.length > 0) {
      query.especialidades = { $in: req.usuario.especialidades };
    }

    const tiposUrgentes = await TipoExame.find(query)
      .populate('especialidades', 'nome')
      .sort({ nome: 1 });
      
    res.status(200).json({
      success: true,
      tiposUrgentes
    });
  } catch (err) {
    console.error('Erro ao listar tipos urgentes');
    res.status(500).json({ error: 'Erro ao listar tipos urgentes' });
  }
};

// Alterar status do tipo de exame - APENAS SUCESSO
exports.alterarStatusTipoExame = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID do tipo de exame inválido' });
    }

    if (!['ativo', 'inativo'].includes(status)) {
      return res.status(400).json({ 
        error: 'Status inválido. Use: ativo ou inativo' 
      });
    }

    // Buscar tipo de exame atual
    const tipoExameOriginal = await TipoExame.findById(id);
    if (!tipoExameOriginal) {
      return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    }

    const statusAnterior = tipoExameOriginal.status;

    // Atualizar status
    const tipoExame = await TipoExame.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    // **LOG DE SUCESSO DA ALTERAÇÃO DE STATUS**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'update',
        description: `Status do tipo de exame alterado: ${tipoExame.nome} - ${statusAnterior} → ${status}`,
        collectionName: 'tipoexames',
        documentId: tipoExame._id,
        before: { status: statusAnterior },
        after: { status: status },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      success: true,
      message: `Status do tipo de exame alterado para ${status}`,
      tipoExame: {
        id: tipoExame._id,
        nome: tipoExame.nome,
        status: tipoExame.status
      }
    });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de exame');
    res.status(500).json({ 
      error: 'Erro ao alterar status do tipo de exame',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Obter estatísticas dos tipos de exame - LOG DE VISUALIZAÇÃO OPCIONAL
exports.obterEstatisticasTiposExame = async (req, res) => {
  try {
    // Estatísticas gerais
    const [
      totalTipos,
      tiposAtivos,
      tiposUrgentes,
      tiposPorEspecialidade
    ] = await Promise.all([
      TipoExame.countDocuments(),
      TipoExame.countDocuments({ status: 'ativo' }),
      TipoExame.countDocuments({ urgente: true, status: 'ativo' }),
      TipoExame.aggregate([
        { $match: { status: 'ativo' } },
        { $unwind: '$especialidades' },
        { $group: { _id: '$especialidades', total: { $sum: 1 } } },
        { $lookup: { from: 'especialidades', localField: '_id', foreignField: '_id', as: 'especialidadeInfo' } },
        { $unwind: '$especialidadeInfo' },
        { $project: { nome: '$especialidadeInfo.nome', total: 1 } },
        { $sort: { total: -1 } }
      ])
    ]);

    // Contar exames por tipo
    const Exame = require('../models/Exame');
    const examesPorTipo = await Exame.aggregate([
      { $group: { _id: '$tipoExame', total: { $sum: 1 } } },
      { $lookup: { from: 'tipoexames', localField: '_id', foreignField: '_id', as: 'tipoInfo' } },
      { $unwind: '$tipoInfo' },
      { $project: { nome: '$tipoInfo.nome', total: 1 } },
      { $sort: { total: -1 } },
      { $limit: 10 }
    ]);

    const estatisticas = {
      totais: {
        totalTipos,
        tiposAtivos,
        tiposInativos: totalTipos - tiposAtivos,
        tiposUrgentes
      },
      tiposPorEspecialidade,
      tiposComMaisExames: examesPorTipo
    };

    // **LOG DE VISUALIZAÇÃO OPCIONAL**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.usuario._id,
          action: 'view',
          description: `Consultou estatísticas dos tipos de exame - ${totalTipos} tipos cadastrados`,
          collectionName: 'tipoexames',
          documentId: null,
          before: null,
          after: estatisticas,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: req.tenant_id
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
    console.error('Erro ao obter estatísticas dos tipos de exame');
    res.status(500).json({ 
      error: 'Erro ao obter estatísticas',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
