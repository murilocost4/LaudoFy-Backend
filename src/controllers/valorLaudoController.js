/* valorLaudoController.js */
const mongoose = require('mongoose');
const ValorLaudo = require('../models/ValorLaudo');
const Usuario = require('../models/Usuario');
const TipoExame = require('../models/TipoExame');
const Especialidade = require('../models/Especialidade');

// Listar todos os valores com filtros
exports.listarValores = async (req, res) => {
  try {
    const { tenantId, medicoId, especialidadeId, tipoExameId, page = 1, limit = 50 } = req.query;

    const matchQuery = {};

    // Aplicar filtros
    if (tenantId && mongoose.Types.ObjectId.isValid(tenantId)) {
      matchQuery.tenantId = new mongoose.Types.ObjectId(tenantId);
    }
    
    if (medicoId && mongoose.Types.ObjectId.isValid(medicoId)) {
      matchQuery.medicoId = new mongoose.Types.ObjectId(medicoId);
    }
    
    if (especialidadeId && mongoose.Types.ObjectId.isValid(especialidadeId)) {
      matchQuery.especialidadeId = new mongoose.Types.ObjectId(especialidadeId);
    }
    
    if (tipoExameId && mongoose.Types.ObjectId.isValid(tipoExameId)) {
      matchQuery.tipoExameId = new mongoose.Types.ObjectId(tipoExameId);
    }

    // Para usuários não adminMaster, filtrar por tenant
    const isAdminMaster = req.user && (req.user.isAdminMaster || req.user.role === 'adminMaster');
    
    if (!isAdminMaster && req.user && req.user.tenant_id) {
      matchQuery.tenantId = new mongoose.Types.ObjectId(req.user.tenant_id);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const valores = await ValorLaudo.find(matchQuery)
      .populate('tenantId', 'nomeFantasia')
      .populate('medicoId', 'nome crm')
      .populate('especialidadeId', 'nome')
      .populate('tipoExameId', 'nome')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ValorLaudo.countDocuments(matchQuery);

    res.status(200).json({
      valores: valores || [],
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total: total
      }
    });

  } catch (error) {
    console.error('Erro ao listar valores');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Criar novo valor
exports.criarValor = async (req, res) => {
  try {
    const { tenantId, medicoId, especialidadeId, tipoExameId, valor, observacoes } = req.body;

    // Validações
    if (!tenantId || !medicoId || !especialidadeId || !tipoExameId || !valor) {
      return res.status(400).json({
        erro: 'Todos os campos obrigatórios devem ser preenchidos'
      });
    }

    if (valor <= 0) {
      return res.status(400).json({
        erro: 'O valor deve ser maior que zero'
      });
    }

    // Verificar se já existe um valor para esta combinação
    const valorExistente = await ValorLaudo.findOne({
      tenantId,
      medicoId,
      especialidadeId,
      tipoExameId
    });

    if (valorExistente) {
      return res.status(400).json({
        erro: 'Já existe um valor configurado para esta combinação'
      });
    }

    const novoValor = new ValorLaudo({
      tenantId,
      medicoId,
      especialidadeId,
      tipoExameId,
      valor: parseFloat(valor),
      observacoes,
      criadoPor: req.usuario?._id || req.user?._id, // Modificado aqui
      dataAtualizacao: new Date()
    });

    await novoValor.save();

    const valorPopulado = await ValorLaudo.findById(novoValor._id)
      .populate('tenantId', 'nomeFantasia')
      .populate('medicoId', 'nome crm')
      .populate('especialidadeId', 'nome')
      .populate('tipoExameId', 'nome');

    res.status(201).json({
      mensagem: 'Valor criado com sucesso',
      valor: valorPopulado
    });

  } catch (error) {
    console.error('Erro ao criar valor');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar valor
exports.atualizarValor = async (req, res) => {
  try {
    const { id } = req.params;
    const { valor, observacoes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ erro: 'ID inválido' });
    }

    if (valor !== undefined && valor <= 0) {
      return res.status(400).json({
        erro: 'O valor deve ser maior que zero'
      });
    }

    const valorLaudo = await ValorLaudo.findById(id);
    if (!valorLaudo) {
      return res.status(404).json({ erro: 'Valor não encontrado' });
    }

    // Para usuários não adminMaster, verificar permissão
    const isAdminMaster = req.user && (req.user.isAdminMaster || req.user.role === 'adminMaster');
    
    if (!isAdminMaster && req.user && req.user.tenant_id) {
      if (valorLaudo.tenantId.toString() !== req.user.tenant_id.toString()) {
        return res.status(403).json({ erro: 'Sem permissão para atualizar este valor' });
      }
    }

    valorLaudo.valor = valor !== undefined ? parseFloat(valor) : valorLaudo.valor;
    valorLaudo.observacoes = observacoes !== undefined ? observacoes : valorLaudo.observacoes;
    valorLaudo.dataAtualizacao = new Date();
    valorLaudo.atualizadoPor = req.user.id;

    await valorLaudo.save();

    const valorPopulado = await ValorLaudo.findById(valorLaudo._id)
      .populate('tenantId', 'nomeFantasia')
      .populate('medicoId', 'nome crm')
      .populate('especialidadeId', 'nome')
      .populate('tipoExameId', 'nome');

    res.status(200).json({
      mensagem: 'Valor atualizado com sucesso',
      valor: valorPopulado
    });

  } catch (error) {
    console.error('Erro ao atualizar valor');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir valor
exports.excluirValor = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ erro: 'ID inválido' });
    }

    const valorLaudo = await ValorLaudo.findById(id);
    if (!valorLaudo) {
      return res.status(404).json({ erro: 'Valor não encontrado' });
    }

    // Para usuários não adminMaster, verificar permissão
    const isAdminMaster = req.user && (req.user.isAdminMaster || req.user.role === 'adminMaster');
    
    if (!isAdminMaster && req.user && req.user.tenant_id) {
      if (valorLaudo.tenantId.toString() !== req.user.tenant_id.toString()) {
        return res.status(403).json({ erro: 'Sem permissão para excluir este valor' });
      }
    }

    await ValorLaudo.findByIdAndDelete(id);

    res.status(200).json({
      mensagem: 'Valor excluído com sucesso'
    });

  } catch (error) {
    console.error('Erro ao excluir valor');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Buscar valor específico
exports.buscarValor = async (req, res) => {
  try {
    const { tenantId, medicoId, especialidadeId, tipoExameId } = req.query;

    if (!tenantId || !medicoId || !especialidadeId || !tipoExameId) {
      return res.status(400).json({
        erro: 'Todos os parâmetros são obrigatórios'
      });
    }

    const valor = await ValorLaudo.findOne({
      tenantId,
      medicoId,
      especialidadeId,
      tipoExameId
    }).populate('tenantId medicoId especialidadeId tipoExameId');

    res.status(200).json({
      valor: valor || null
    });

  } catch (error) {
    console.error('Erro ao buscar valor');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Criar valores em lote
exports.criarValoresEmLote = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      selectedTenants,
      selectedMedicos,
      selectedEspecialidades,
      selectedTiposExame,
      valor,
      observacoes
    } = req.body;

    if (!selectedTenants?.length || !selectedMedicos?.length || 
        !selectedEspecialidades?.length || !selectedTiposExame?.length || !valor) {
      return res.status(400).json({
        erro: 'Todos os campos obrigatórios devem ser preenchidos'
      });
    }

    const valoresCreated = [];
    const valoresUpdated = [];
    const erros = [];

    // Iterate through all combinations
    for (const tenantId of selectedTenants) {
      for (const medicoId of selectedMedicos) {
        for (const especialidadeId of selectedEspecialidades) {
          for (const tipoExameId of selectedTiposExame) {
            try {
              // Validate doctor's specialty
              const medicoValido = await Usuario.findOne({
                _id: medicoId,
                especialidades: especialidadeId,
                role: 'medico'
              }).session(session);

              if (!medicoValido) {
                erros.push(`Médico ${medicoId} não possui especialidade ${especialidadeId}`);
                continue;
              }

              // Check if configuration exists
              const valorExistente = await ValorLaudo.findOne({
                tenantId,
                medicoId,
                especialidadeId,
                tipoExameId
              }).session(session);

              if (valorExistente) {
                valorExistente.valor = parseFloat(valor);
                valorExistente.observacoes = observacoes;
                valorExistente.atualizadoPor = req.user.id;
                await valorExistente.save({ session });
                valoresUpdated.push(valorExistente);
              } else {
                const novoValor = new ValorLaudo({
                  tenantId,
                  medicoId,
                  especialidadeId,
                  tipoExameId,
                  valor: parseFloat(valor),
                  observacoes,
                  criadoPor: req.user.id
                });
                await novoValor.save({ session });
                valoresCreated.push(novoValor);
              }
            } catch (err) {
              erros.push(`Erro ao processar configuração: ${err.message}`);
            }
          }
        }
      }
    }

    await session.commitTransaction();

    res.status(200).json({
      mensagem: 'Processamento em lote concluído',
      detalhes: {
        criados: valoresCreated.length,
        atualizados: valoresUpdated.length,
        erros: erros
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Erro ao criar valores em lote');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};