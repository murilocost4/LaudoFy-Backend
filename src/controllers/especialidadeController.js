const mongoose = require('mongoose');
const Especialidade = require('../models/Especialidade');
const TipoExame = require('../models/TipoExame');
const AuditLog = require('../models/AuditModel');

// Listar especialidades - SEM AUDITORIA (consulta simples)
exports.listarEspecialidades = async (req, res) => {
  try {
    const especialidades = await Especialidade.find();
    res.status(200).json(especialidades);
  } catch (err) {
    console.error('Erro ao listar especialidades');
    res.status(500).json({ error: 'Erro ao listar especialidades' });
  }
};

// Criar especialidade - APENAS SUCESSO
exports.criarEspecialidade = async (req, res) => {
  try {
    const { nome, descricao, status } = req.body;

    // Verificar se já existe especialidade com mesmo nome
    const especialidadeExistente = await Especialidade.findOne({ nome });
    if (especialidadeExistente) {
      return res.status(400).json({ error: 'Especialidade já existe com este nome' });
    }

    const especialidade = new Especialidade(req.body);
    await especialidade.save();

    // **LOG DE SUCESSO DA CRIAÇÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'create',
        description: `Nova especialidade criada: ${especialidade.nome}`,
        collectionName: 'especialidades',
        documentId: especialidade._id,
        before: null,
        after: {
          id: especialidade._id,
          nome: especialidade.nome,
          descricao: especialidade.descricao,
          status: especialidade.status
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(201).json(especialidade);
  } catch (err) {
    console.error('Erro ao criar especialidade');
    res.status(400).json({ error: 'Erro ao criar especialidade' });
  }
};

// Atualizar especialidade - APENAS SUCESSO
exports.atualizarEspecialidade = async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, status } = req.body;

    // Buscar especialidade original
    const especialidadeOriginal = await Especialidade.findById(id);
    if (!especialidadeOriginal) {
      return res.status(404).json({ error: 'Especialidade não encontrada' });
    }

    // Verificar se já existe outra especialidade com mesmo nome
    if (nome && nome !== especialidadeOriginal.nome) {
      const especialidadeExistente = await Especialidade.findOne({ 
        nome, 
        _id: { $ne: id } 
      });
      if (especialidadeExistente) {
        return res.status(400).json({ error: 'Já existe especialidade com este nome' });
      }
    }

    // Dados antes da atualização
    const dadosAntes = {
      nome: especialidadeOriginal.nome,
      descricao: especialidadeOriginal.descricao,
      status: especialidadeOriginal.status
    };

    // Atualizar especialidade
    const especialidade = await Especialidade.findByIdAndUpdate(id, req.body, { new: true });

    // **LOG DE SUCESSO DA ATUALIZAÇÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'update',
        description: `Especialidade atualizada: ${especialidade.nome}`,
        collectionName: 'especialidades',
        documentId: especialidade._id,
        before: dadosAntes,
        after: {
          nome: especialidade.nome,
          descricao: especialidade.descricao,
          status: especialidade.status
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(200).json(especialidade);
  } catch (err) {
    console.error('Erro ao atualizar especialidade');
    res.status(400).json({ error: 'Erro ao atualizar especialidade' });
  }
};

// Deletar especialidade - APENAS SUCESSO
exports.deletarEspecialidade = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar especialidade antes de deletar
    const especialidade = await Especialidade.findById(id);
    if (!especialidade) {
      return res.status(404).json({ error: 'Especialidade não encontrada' });
    }

    // Verificar se existem tipos de exame vinculados
    const tiposExameVinculados = await TipoExame.countDocuments({
      especialidades: especialidade._id
    });

    if (tiposExameVinculados > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir especialidade que possui tipos de exame vinculados',
        detalhes: `${tiposExameVinculados} tipo(s) de exame vinculado(s)`
      });
    }

    // Dados antes da exclusão
    const dadosAntes = {
      nome: especialidade.nome,
      descricao: especialidade.descricao,
      status: especialidade.status
    };

    // Deletar especialidade
    await Especialidade.findByIdAndDelete(id);

    // **LOG DE SUCESSO DA EXCLUSÃO**
    try {
      await AuditLog.create({
        userId: req.usuario._id,
        action: 'delete',
        description: `Especialidade excluída: ${especialidade.nome}`,
        collectionName: 'especialidades',
        documentId: id,
        before: dadosAntes,
        after: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(200).json({ message: 'Especialidade deletada com sucesso' });
  } catch (err) {
    console.error('Erro ao deletar especialidade');
    res.status(500).json({ error: 'Erro ao deletar especialidade' });
  }
};

// Buscar especialidade - SEM AUDITORIA (consulta simples)
exports.buscarEspecialidade = async (req, res) => {
  try {
    const especialidadeId = req.params.id;
    
    // Validar se o ID é um ObjectId válido
    if (!mongoose.Types.ObjectId.isValid(especialidadeId)) {
      return res.status(400).json({ erro: 'ID de especialidade inválido' });
    }

    const especialidade = await Especialidade.findById(especialidadeId);
    
    if (!especialidade) {
      return res.status(404).json({ erro: 'Especialidade não encontrada' });
    }

    // Busca os tipos de exame que têm esta especialidade
    const tiposExame = await TipoExame.find({
      especialidades: especialidade._id
    });
    
    res.json({
      ...especialidade.toObject(),
      tiposExame
    });
  } catch (err) {
    console.error('Erro ao buscar especialidade');
    res.status(500).json({ erro: 'Erro ao buscar especialidade' });
  }
};

// Buscar tipos de exame por especialidade - SEM AUDITORIA (consulta simples)
exports.buscarTiposExame = async (req, res) => {
  try {
    const especialidadeId = req.params.id;
        
    // Validar se o ID é um ObjectId válido
    if (!mongoose.Types.ObjectId.isValid(especialidadeId)) {
      console.error('ID de especialidade inválido:', especialidadeId);
      return res.status(400).json({ erro: 'ID de especialidade inválido' });
    }

    const especialidade = await Especialidade.findById(especialidadeId);
    
    if (!especialidade) {
      console.error('Especialidade não encontrada:', especialidadeId);
      return res.status(404).json({ erro: 'Especialidade não encontrada' });
    }

    // Busca os tipos de exame que têm esta especialidade
    const tiposExame = await TipoExame.find({
      especialidades: especialidade._id,
      status: { $ne: 'inativo' } // Apenas tipos ativos
    }).populate('especialidades', 'nome');
        
    res.json({ tiposExame });
  } catch (err) {
    console.error('Erro ao buscar tipos de exame');
    res.status(500).json({ erro: 'Erro ao buscar tipos de exame', detalhes: err.message });
  }
};

// Buscar especialidades ativas - SEM AUDITORIA (consulta simples)
exports.listarEspecialidadesAtivas = async (req, res) => {
  try {
    const especialidades = await Especialidade.find({ 
      status: { $ne: 'inativo' } 
    }).select('nome descricao status').sort({ nome: 1 });
    
    res.status(200).json(especialidades);
  } catch (err) {
    console.error('Erro ao listar especialidades ativas');
    res.status(500).json({ error: 'Erro ao listar especialidades ativas' });
  }
};

// Estatísticas de especialidades - LOG DE VISUALIZAÇÃO OPCIONAL
exports.obterEstatisticasEspecialidades = async (req, res) => {
  try {
    const [
      totalEspecialidades,
      especialidadesAtivas,
      especialidadesInativas,
      especialidadesComTipos
    ] = await Promise.all([
      Especialidade.countDocuments(),
      Especialidade.countDocuments({ status: { $ne: 'inativo' } }),
      Especialidade.countDocuments({ status: 'inativo' }),
      Especialidade.aggregate([
        {
          $lookup: {
            from: 'tipoexames',
            localField: '_id',
            foreignField: 'especialidades',
            as: 'tiposExame'
          }
        },
        {
          $match: {
            'tiposExame.0': { $exists: true }
          }
        },
        {
          $count: 'total'
        }
      ])
    ]);

    const estatisticas = {
      totalEspecialidades,
      especialidadesAtivas,
      especialidadesInativas,
      especialidadesComTipos: especialidadesComTipos[0]?.total || 0,
      especialidadesSemTipos: totalEspecialidades - (especialidadesComTipos[0]?.total || 0)
    };

    // **LOG DE VISUALIZAÇÃO OPCIONAL**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.usuario._id,
          action: 'view',
          description: 'Consultou estatísticas de especialidades',
          collectionName: 'especialidades',
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

    res.json(estatisticas);
  } catch (err) {
    console.error('Erro ao obter estatísticas de especialidades');
    res.status(500).json({ erro: 'Erro ao obter estatísticas' });
  }
};
