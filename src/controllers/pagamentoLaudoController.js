const PagamentoLaudo = require('../models/PagamentoLaudo');
const Laudo = require('../models/Laudo');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditModel');
const { decrypt } = require('../utils/crypto');
const mongoose = require('mongoose');

// Listar laudos por médico - SEM AUDITORIA (consulta)
exports.listarLaudosPorMedico = async (req, res) => {
  try {
    const { medicoId, status, dataInicio, dataFim, page = 1, limit = 10 } = req.query;
    const tenantId = req.user.isAdminMaster ? req.query.tenantId : req.user.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID é obrigatório' });
    }

    const query = {
      tenant_id: tenantId,
    };

    if (medicoId) {
      query.medicoResponsavelId = medicoId;
    }

    if (status) {
      query.pagamentoRegistrado = status === 'pago';
    }

    if (dataInicio && dataFim) {
      query.dataAssinatura = {
        $gte: new Date(dataInicio),
        $lte: new Date(dataFim)
      };
    }

    const skip = (page - 1) * limit;

    const [laudos, total] = await Promise.all([
      Laudo.find(query)
        .populate('exame', 'paciente tipoExame')
        .populate('tipoExameId', 'nome')
        .populate('medico', 'nome email')
        .sort({ dataAssinatura: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Laudo.countDocuments(query)
    ]);

    // Descriptografar dados sensíveis usando getters automáticos
    const laudosFormatados = laudos.map(laudo => {
      const laudoFormatado = laudo.toObject();
      
      // Nome do médico já descriptografado pelo getter
      if (laudoFormatado.medico?.nome) {
        try {
          // Verificar se ainda está criptografado (fallback)
          if (typeof laudoFormatado.medico.nome === 'string' && laudoFormatado.medico.nome.includes(':')) {
            laudoFormatado.medico.nome = decrypt(laudoFormatado.medico.nome);
          }
        } catch (err) {
          console.error('Erro ao descriptografar nome do médico');
          laudoFormatado.medico.nome = 'Nome não disponível';
        }
      }

      return laudoFormatado;
    });

    res.json({
      laudos: laudosFormatados,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Erro ao listar laudos por médico');
    res.status(500).json({ 
      erro: 'Erro ao listar laudos',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Registrar pagamento em lote - APENAS SUCESSO
exports.registrarPagamento = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      tenant_id,
      medicoId,
      laudos,
      valorTotal,
      valorDesconto,
      percentualDesconto,
      valorFinal,
      meioPagamento,
      observacoes
    } = req.body;

    // Validações
    if (!medicoId || !laudos || laudos.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ erro: 'Médico e laudos são obrigatórios' });
    }

    if (!valorTotal || valorTotal <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ erro: 'Valor total deve ser maior que zero' });
    }

    // Verificar se os laudos existem e não estão pagos
    const laudosParaPagamento = await Laudo.find({
      _id: { $in: laudos },
      tenant_id: tenant_id,
      pagamentoRegistrado: false
    }).populate('medico', 'nome email');

    if (laudosParaPagamento.length !== laudos.length) {
      await session.abortTransaction();
      return res.status(400).json({ 
        erro: 'Alguns laudos não foram encontrados ou já estão pagos' 
      });
    }

    // Buscar dados do médico para auditoria
    const medico = await Usuario.findById(medicoId).select('nome email');
    if (!medico) {
      await session.abortTransaction();
      return res.status(404).json({ erro: 'Médico não encontrado' });
    }

    // Criar o registro de pagamento
    const pagamento = new PagamentoLaudo({
      tenant_id,
      medicoId,
      laudos,
      valorTotal,
      valorDesconto: valorDesconto || 0,
      percentualDesconto: percentualDesconto || 0,
      valorFinal,
      meioPagamento,
      observacoes,
      registradoPor: req.user._id
    });

    await pagamento.save({ session });

    // Atualizar os laudos
    await Laudo.updateMany(
      { _id: { $in: laudos } },
      { 
        $set: { 
          pagamentoId: pagamento._id,
          pagamentoRegistrado: true,
          dataPagamento: new Date(),
          valorPago: valorFinal / laudos.length // Distribuir valor equally
        }
      },
      { session }
    );

    await session.commitTransaction();

    // **LOG DE SUCESSO DO PAGAMENTO EM LOTE**
    try {
      // Descriptografar nome do médico para auditoria
      let nomeMedico = medico.nome;
      if (typeof nomeMedico === 'string' && nomeMedico.includes(':')) {
        nomeMedico = decrypt(nomeMedico);
      }

      await AuditLog.create({
        userId: req.user._id,
        action: 'create',
        description: `Pagamento em lote registrado - Médico: ${nomeMedico} - ${laudos.length} laudos - Valor: R$ ${valorFinal}`,
        collectionName: 'pagamentolaudos',
        documentId: pagamento._id,
        before: null,
        after: {
          medicoId,
          medicoNome: nomeMedico,
          quantidadeLaudos: laudos.length,
          valorTotal,
          valorDesconto,
          valorFinal,
          meioPagamento
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(201).json({
      success: true,
      mensagem: 'Pagamento registrado com sucesso',
      pagamento: {
        id: pagamento._id,
        valorFinal: pagamento.valorFinal,
        quantidadeLaudos: laudos.length,
        dataPagamento: pagamento.dataPagamento
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Erro ao registrar pagamento');
    res.status(500).json({ 
      erro: 'Erro ao registrar pagamento',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

// Atualizar pagamento - APENAS SUCESSO
exports.atualizarPagamento = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      valorDesconto,
      percentualDesconto,
      valorFinal,
      meioPagamento,
      observacoes,
      status
    } = req.body;

    // Buscar pagamento original
    const pagamentoOriginal = await PagamentoLaudo.findById(id)
      .populate('medicoId', 'nome email');

    if (!pagamentoOriginal) {
      return res.status(404).json({ erro: 'Pagamento não encontrado' });
    }

    // Verificar tenant
    if (!req.user.isAdminMaster && !pagamentoOriginal.tenant_id.equals(req.user.tenant_id)) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }

    // Dados antes da atualização
    const dadosAntes = {
      valorDesconto: pagamentoOriginal.valorDesconto,
      valorFinal: pagamentoOriginal.valorFinal,
      meioPagamento: pagamentoOriginal.meioPagamento,
      status: pagamentoOriginal.status
    };

    // Atualizar campos
    if (valorDesconto !== undefined) pagamentoOriginal.valorDesconto = valorDesconto;
    if (percentualDesconto !== undefined) pagamentoOriginal.percentualDesconto = percentualDesconto;
    if (valorFinal !== undefined) pagamentoOriginal.valorFinal = valorFinal;
    if (meioPagamento) pagamentoOriginal.meioPagamento = meioPagamento;
    if (observacoes !== undefined) pagamentoOriginal.observacoes = observacoes;
    if (status) pagamentoOriginal.status = status;

    await pagamentoOriginal.save();

    // **LOG DE SUCESSO DA ATUALIZAÇÃO**
    try {
      let nomeMedico = pagamentoOriginal.medicoId?.nome;
      if (typeof nomeMedico === 'string' && nomeMedico.includes(':')) {
        nomeMedico = decrypt(nomeMedico);
      }

      await AuditLog.create({
        userId: req.user._id,
        action: 'update',
        description: `Pagamento atualizado - Médico: ${nomeMedico} - Valor: R$ ${pagamentoOriginal.valorFinal}`,
        collectionName: 'pagamentolaudos',
        documentId: pagamentoOriginal._id,
        before: dadosAntes,
        after: {
          valorDesconto: pagamentoOriginal.valorDesconto,
          valorFinal: pagamentoOriginal.valorFinal,
          meioPagamento: pagamentoOriginal.meioPagamento,
          status: pagamentoOriginal.status
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: pagamentoOriginal.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      success: true,
      mensagem: 'Pagamento atualizado com sucesso',
      pagamento: pagamentoOriginal
    });

  } catch (error) {
    console.error('Erro ao atualizar pagamento');
    res.status(500).json({ 
      erro: 'Erro ao atualizar pagamento',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cancelar pagamento - APENAS SUCESSO
exports.cancelarPagamento = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { motivo } = req.body;

    // Buscar pagamento
    const pagamento = await PagamentoLaudo.findById(id)
      .populate('medicoId', 'nome email');

    if (!pagamento) {
      await session.abortTransaction();
      return res.status(404).json({ erro: 'Pagamento não encontrado' });
    }

    // Verificar tenant
    if (!req.user.isAdminMaster && !pagamento.tenant_id.equals(req.user.tenant_id)) {
      await session.abortTransaction();
      return res.status(403).json({ erro: 'Acesso negado' });
    }

    if (pagamento.status === 'cancelado') {
      await session.abortTransaction();
      return res.status(400).json({ erro: 'Pagamento já está cancelado' });
    }

    // Dados antes do cancelamento
    const dadosAntes = {
      status: pagamento.status,
      valorFinal: pagamento.valorFinal,
      quantidadeLaudos: pagamento.laudos.length
    };

    // Cancelar pagamento
    pagamento.status = 'cancelado';
    pagamento.observacoes = `${pagamento.observacoes || ''}\nCancelado: ${motivo || 'Não informado'}`;
    await pagamento.save({ session });

    // Atualizar laudos para não pagos
    await Laudo.updateMany(
      { _id: { $in: pagamento.laudos } },
      { 
        $set: { 
          pagamentoRegistrado: false,
          valorPago: 0
        },
        $unset: {
          pagamentoId: 1,
          dataPagamento: 1
        }
      },
      { session }
    );

    await session.commitTransaction();

    // **LOG DE SUCESSO DO CANCELAMENTO**
    try {
      let nomeMedico = pagamento.medicoId?.nome;
      if (typeof nomeMedico === 'string' && nomeMedico.includes(':')) {
        nomeMedico = decrypt(nomeMedico);
      }

      await AuditLog.create({
        userId: req.user._id,
        action: 'update',
        description: `Pagamento cancelado - Médico: ${nomeMedico} - Motivo: ${motivo || 'Não informado'}`,
        collectionName: 'pagamentolaudos',
        documentId: pagamento._id,
        before: dadosAntes,
        after: {
          status: 'cancelado',
          motivo: motivo || 'Não informado'
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: pagamento.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      success: true,
      mensagem: 'Pagamento cancelado com sucesso',
      pagamento: {
        id: pagamento._id,
        status: pagamento.status,
        motivo: motivo || 'Não informado'
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Erro ao cancelar pagamento');
    res.status(500).json({ 
      erro: 'Erro ao cancelar pagamento',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

// Gerar recibo - LOG DE GERAÇÃO OPCIONAL
exports.gerarRecibo = async (req, res) => {
  try {
    const { id } = req.params;

    const pagamento = await PagamentoLaudo.findById(id)
      .populate('medicoId', 'nome crm email')
      .populate({
        path: 'laudos',
        populate: {
          path: 'exame',
          populate: {
            path: 'paciente',
            select: 'nome cpf'
          }
        }
      })
      .populate('tenant_id', 'nomeFantasia cnpj endereco')
      .populate('registradoPor', 'nome email');

    if (!pagamento) {
      return res.status(404).json({ erro: 'Pagamento não encontrado' });
    }

    // Verificar tenant
    if (!req.user.isAdminMaster && !pagamento.tenant_id.equals(req.user.tenant_id)) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }

    // Descriptografar dados para o recibo
    const reciboData = {
      pagamento: {
        ...pagamento.toObject(),
        medicoId: {
          ...pagamento.medicoId.toObject(),
          nome: pagamento.medicoId.nome.includes(':') 
            ? decrypt(pagamento.medicoId.nome) 
            : pagamento.medicoId.nome
        }
      }
    };

    // **LOG DE GERAÇÃO DO RECIBO (OPCIONAL)**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.user._id,
          action: 'export',
          description: `Recibo gerado para pagamento - Médico: ${reciboData.pagamento.medicoId.nome}`,
          collectionName: 'pagamentolaudos',
          documentId: pagamento._id,
          before: null,
          after: {
            reciboGerado: true,
            valorFinal: pagamento.valorFinal
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: pagamento.tenant_id
        });
      } catch (auditError) {
        console.error('Erro ao criar log de auditoria');
      }
    }

    // TODO: Implementar geração real do PDF
    // Por enquanto, retornar os dados para o frontend gerar
    
    res.json({
      success: true,
      recibo: reciboData,
      url: `${req.protocol}://${req.get('host')}/api/pagamentos/${id}/recibo.pdf`
    });
  } catch (error) {
    console.error('Erro ao gerar recibo');
    res.status(500).json({ 
      erro: 'Erro ao gerar recibo',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Listar pagamentos - SEM AUDITORIA (consulta)
exports.listarPagamentos = async (req, res) => {
  try {
    const { 
      medicoId, 
      status = 'pago', 
      dataInicio, 
      dataFim, 
      page = 1, 
      limit = 10 
    } = req.query;

    const tenantId = req.user.isAdminMaster ? req.query.tenantId : req.user.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID é obrigatório' });
    }

    const query = { tenant_id: tenantId };

    if (medicoId) {
      query.medicoId = medicoId;
    }

    if (status) {
      query.status = status;
    }

    if (dataInicio || dataFim) {
      query.dataPagamento = {};
      if (dataInicio) {
        query.dataPagamento.$gte = new Date(dataInicio);
      }
      if (dataFim) {
        const dataFimDate = new Date(dataFim);
        dataFimDate.setHours(23, 59, 59, 999);
        query.dataPagamento.$lte = dataFimDate;
      }
    }

    const skip = (page - 1) * limit;

    const [pagamentos, total] = await Promise.all([
      PagamentoLaudo.find(query)
        .populate('medicoId', 'nome email crm')
        .populate('registradoPor', 'nome email')
        .sort({ dataPagamento: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      PagamentoLaudo.countDocuments(query)
    ]);

    // Descriptografar dados sensíveis usando getters automáticos
    const pagamentosFormatados = pagamentos.map(pagamento => {
      const pagamentoFormatado = pagamento.toObject();
      
      // Nome do médico já descriptografado pelo getter
      if (pagamentoFormatado.medicoId?.nome) {
        try {
          // Verificar se ainda está criptografado (fallback)
          if (typeof pagamentoFormatado.medicoId.nome === 'string' && pagamentoFormatado.medicoId.nome.includes(':')) {
            pagamentoFormatado.medicoId.nome = decrypt(pagamentoFormatado.medicoId.nome);
          }
        } catch (err) {
          console.error('Erro ao descriptografar nome do médico');
          pagamentoFormatado.medicoId.nome = 'Nome não disponível';
        }
      }

      // Nome do usuário que registrou já descriptografado pelo getter
      if (pagamentoFormatado.registradoPor?.nome) {
        try {
          // Verificar se ainda está criptografado (fallback)
          if (typeof pagamentoFormatado.registradoPor.nome === 'string' && pagamentoFormatado.registradoPor.nome.includes(':')) {
            pagamentoFormatado.registradoPor.nome = decrypt(pagamentoFormatado.registradoPor.nome);
          }
        } catch (err) {
          console.error('Erro ao descriptografar nome do usuário');
          pagamentoFormatado.registradoPor.nome = 'Nome não disponível';
        }
      }

      return pagamentoFormatado;
    });

    res.json({
      pagamentos: pagamentosFormatados,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Erro ao listar pagamentos');
    res.status(500).json({ 
      erro: 'Erro ao listar pagamentos',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter estatísticas de pagamento - SEM AUDITORIA (consulta)
exports.obterEstatisticasPagamento = async (req, res) => {
  try {
    const { periodo = '30' } = req.query;
    const tenantId = req.user.isAdminMaster ? req.query.tenantId : req.user.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID é obrigatório' });
    }
    
    const dataFim = new Date();
    dataFim.setHours(23, 59, 59, 999);
    
    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - parseInt(periodo));
    dataInicio.setHours(0, 0, 0, 0);

    const query = {
      tenant_id: tenantId,
      dataPagamento: { $gte: dataInicio, $lte: dataFim }
    };

    const [
      totalPagamentos,
      pagamentosPagos,
      pagamentosCancelados,
      valorTotalPago
    ] = await Promise.all([
      PagamentoLaudo.countDocuments(query),
      PagamentoLaudo.countDocuments({ ...query, status: 'pago' }),
      PagamentoLaudo.countDocuments({ ...query, status: 'cancelado' }),
      PagamentoLaudo.aggregate([
        { $match: { ...query, status: 'pago' } },
        { $group: { _id: null, total: { $sum: '$valorFinal' } } }
      ])
    ]);

    const valorTotal = valorTotalPago[0]?.total || 0;
    const ticketMedio = pagamentosPagos > 0 ? valorTotal / pagamentosPagos : 0;

    res.json({
      periodo: `${periodo} dias`,
      estatisticas: {
        totalPagamentos,
        pagamentosPagos,
        pagamentosCancelados,
        valorTotalPago: valorTotal,
        ticketMedio: parseFloat(ticketMedio.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas');
    res.status(500).json({ 
      erro: 'Erro ao obter estatísticas',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};