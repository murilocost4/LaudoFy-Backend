/* financeiroController.js */
const Laudo = require('../models/Laudo');
const Usuario = require('../models/Usuario');
const TipoExame = require('../models/TipoExame');
const AuditLog = require('../models/AuditModel');
const mongoose = require('mongoose');
const { decrypt } = require('../utils/crypto');

// Listar laudos por médico - SEM AUDITORIA (consulta)
exports.listarLaudosPorMedico = async (req, res) => {
  try {
    const { medicoId, status, dataInicio, dataFim } = req.query;
    let { tenantId } = req.query;

    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }

    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID não disponível' });
    }

    const query = { tenant_id: tenantId };

    if (medicoId) {
      query.medicoResponsavelId = medicoId;
    }

    if (status) {
      query.pagamentoRegistrado = status === 'pago';
    }

    if (dataInicio || dataFim) {
      query.dataAssinatura = {};
      if (dataInicio) query.dataAssinatura.$gte = new Date(dataInicio);
      if (dataFim) query.dataAssinatura.$lte = new Date(dataFim);
    }

    const laudos = await Laudo.find(query)
      .populate({
        path: 'exame',
        select: 'paciente tipoExame',
        populate: [
          { path: 'paciente', select: 'nome' },
          { path: 'tipoExame', select: 'nome' }
        ]
      })
      .populate('medicoResponsavelId', 'nome especialidades') // Garantir que o médico seja populado
      .sort({ dataAssinatura: -1 });

    // Buscar valores configurados para cada laudo
    const ValorLaudo = require('../models/ValorLaudo');
    const laudosComValor = await Promise.all(
      laudos.map(async (laudo) => {
        let valorConfigurado = null;
        
        // Tentar buscar valor configurado
        if (laudo.medicoResponsavelId && laudo.exame?.tipoExame?._id) {
          const valorConfig = await ValorLaudo.findOne({
            tenantId,
            medicoId: laudo.medicoResponsavelId._id,
            tipoExameId: laudo.exame.tipoExame._id
          }).lean();
          
          valorConfigurado = valorConfig ? valorConfig.valor : null;
        }

        return {
          ...laudo.toObject(),
          valorConfigurado: valorConfigurado || laudo.valorPago || 0,
          pacienteNome: laudo.exame?.paciente?.nome || 'N/A', // O getter já descriptografa
          tipoExameNome: laudo.exame?.tipoExame?.nome || 'N/A',
          medicoNome: laudo.medicoResponsavelId?.nome || 'N/A', // O getter já descriptografa
          // Garantir que temos o ID do médico em formato string
          medicoId: laudo.medicoResponsavelId?._id?.toString() || laudo.medicoResponsavelId?.toString()
        };
      })
    );

    res.json(laudosComValor);
  } catch (error) {
    console.error('Erro ao listar laudos');
    res.status(500).json({ erro: 'Erro ao listar laudos' });
  }
};

// Registrar pagamento - APENAS SUCESSO
exports.registrarPagamento = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { laudoIds, valorTotal, desconto, meioPagamento, observacoes } = req.body;
    let { tenantId } = req.body;

    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }

    if (!laudoIds || !Array.isArray(laudoIds) || laudoIds.length === 0) {
      return res.status(400).json({ erro: 'Nenhum laudo selecionado para pagamento' });
    }

    // Ensure we have valid numbers
    const valorFinal = parseFloat(valorTotal) || 0;
    const valorDesconto = parseFloat(desconto) || 0;

    // Verificar se algum laudo já foi pago - CRÍTICO
    const laudosJaPagos = await Laudo.find({
      _id: { $in: laudoIds },
      pagamentoRegistrado: true
    }).session(session);

    if (laudosJaPagos.length > 0) {
      const laudosJaPagosIds = laudosJaPagos.map(l => l._id.toString());
      return res.status(400).json({
        erro: 'Alguns laudos já estão pagos',
        laudosJaPagos: laudosJaPagosIds
      });
    }

    // Obter laudos válidos (não pagos)
    const laudos = await Laudo.find({
      _id: { $in: laudoIds },
      tenant_id: tenantId,
      pagamentoRegistrado: { $ne: true }
    })
    .populate('medicoResponsavelId', 'nome')
    .populate({
      path: 'exame',
      populate: [
        { path: 'paciente', select: 'nome cpf' },
        { path: 'tipoExame', select: 'nome' }
      ]
    })
    .session(session);

    if (laudos.length === 0) {
      return res.status(404).json({ erro: 'Nenhum laudo não pago encontrado com os IDs fornecidos' });
    }

    // NOVA VALIDAÇÃO: Verificar se todos os laudos são do mesmo médico
    const medicosUnicos = [...new Set(laudos.map(laudo => laudo.medicoResponsavelId.toString()))];
    
    if (medicosUnicos.length > 1) {
      return res.status(400).json({ 
        erro: 'Não é possível registrar pagamento para laudos de médicos diferentes. Selecione laudos de apenas um médico por vez.',
        medicosEncontrados: medicosUnicos.length
      });
    }

    const medicoId = laudos[0].medicoResponsavelId;

    // Criar registro de pagamento
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    const pagamento = new PagamentoLaudo({
      tenant_id: tenantId,
      medicoId: medicoId._id,
      laudos: laudos.map(l => l._id),
      valorTotal: laudos.reduce((sum, laudo) => sum + (laudo.valorPago || 0), 0),
      valorDesconto: valorDesconto,
      valorFinal: valorFinal,
      meioPagamento,
      observacoes,
      dataPagamento: new Date(),
      registradoPor: req.usuario.id
    });

    await pagamento.save({ session });

    // Atualizar cada laudo individualmente usando o método específico
    for (const laudo of laudos) {
      try {
        await laudo.registrarPagamento(
          pagamento._id,
          meioPagamento,
          observacoes,
          req.usuario.id,
          req.usuario.nome,
          laudo.valorPago || 0
        );
      } catch (error) {
        console.error(`Erro ao registrar pagamento no laudo ${laudo._id}`);
        throw error;
      }
    }

    await session.commitTransaction();

    // Verificar se os laudos foram atualizados corretamente
    const laudosAtualizados = await Laudo.find({
      _id: { $in: laudos.map(l => l._id) }
    });

    const laudosPagosContagem = laudosAtualizados.filter(l => l.pagamentoRegistrado).length;

    // **LOG DE SUCESSO DO PAGAMENTO**
    try {
      // Preparar dados para auditoria
      const laudosInfo = laudos.map(laudo => {
        let nomePaciente = laudo.exame?.paciente?.nome || 'N/A';
        let cpfPaciente = laudo.exame?.paciente?.cpf || 'N/A';
        
        // Descriptografar se necessário
        if (typeof nomePaciente === 'string' && nomePaciente.includes(':')) {
          try {
            const { decrypt } = require('../utils/crypto');
            nomePaciente = decrypt(nomePaciente);
          } catch (error) {
            console.error('Erro ao descriptografar nome do paciente');
          }
        }
        
        if (typeof cpfPaciente === 'string' && cpfPaciente.includes(':')) {
          try {
            const { decrypt } = require('../utils/crypto');
            cpfPaciente = decrypt(cpfPaciente);
          } catch (error) {
            console.error('Erro ao descriptografar CPF do paciente');
          }
        }

        return {
          laudoId: laudo._id,
          paciente: nomePaciente,
          cpf: cpfPaciente,
          tipoExame: laudo.exame?.tipoExame?.nome || 'N/A',
          valor: laudo.valorPago || 0
        };
      });

      let nomeMedico = medicoId.nome || 'N/A';
      if (typeof nomeMedico === 'string' && nomeMedico.includes(':')) {
        try {
          const { decrypt } = require('../utils/crypto');
          nomeMedico = decrypt(nomeMedico);
        } catch (error) {
          console.error('Erro ao descriptografar nome do médico');
        }
      }

      await AuditLog.create({
        userId: req.usuario.id,
        action: 'create',
        description: `Pagamento registrado para ${laudos.length} laudo(s) do médico ${nomeMedico} - Valor: R$ ${valorFinal.toFixed(2)}`,
        collectionName: 'pagamentos',
        documentId: pagamento._id,
        before: null,
        after: {
          pagamentoId: pagamento._id,
          medicoNome: nomeMedico,
          quantidadeLaudos: laudos.length,
          valorTotal: pagamento.valorTotal,
          valorDesconto: valorDesconto,
          valorFinal: valorFinal,
          meioPagamento,
          laudos: laudosInfo
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: tenantId
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({ 
      mensagem: 'Pagamento registrado com sucesso',
      pagamentoId: pagamento._id,
      laudosPagos: laudosPagosContagem,
      totalLaudos: laudos.length,
      medicoId: medicoId._id
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Erro ao registrar pagamento');
    res.status(500).json({ erro: 'Erro ao registrar pagamento', detalhes: error.message });
  } finally {
    session.endSession();
  }
};

// Gerar recibo - SEM AUDITORIA (geração de documento)
exports.gerarRecibo = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the payment info
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    const pagamento = await PagamentoLaudo.findById(id)
      .populate('medicoId', 'nome crm')
      .populate('laudos')
      .populate('registradoPor', 'nome');
      
    if (!pagamento) {
      return res.status(404).json({ erro: 'Pagamento não encontrado' });
    }
    
    // Generate PDF receipt
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibo_${id}.pdf`);
    
    // Pipe the PDF to the response
    doc.pipe(res);
    
    // Add content to PDF
    doc.fontSize(20).text('RECIBO DE PAGAMENTO', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12).text(`Recibo Nº: ${pagamento._id}`, { align: 'right' });
    doc.text(`Data: ${new Date(pagamento.dataPagamento).toLocaleDateString('pt-BR')}`, { align: 'right' });
    doc.moveDown();
    
    doc.text(`Médico: ${pagamento.medicoId?.nome ? decrypt(pagamento.medicoId.nome) : 'N/A'}`);
    doc.text(`CRM: ${pagamento.medicoId.crm?.numero || 'N/A'}`);
    doc.moveDown();
    
    doc.text('Laudos incluídos neste pagamento:');
    doc.moveDown(0.5);
    
    // Add table headers
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [150, 150, 150];
    
    doc.font('Helvetica-Bold');
    doc.text('Paciente', tableLeft, tableTop);
    doc.text('Exame', tableLeft + colWidths[0], tableTop);
    doc.text('Valor', tableLeft + colWidths[0] + colWidths[1], tableTop);
    doc.font('Helvetica');
    
    doc.moveTo(tableLeft, tableTop + 20)
       .lineTo(tableLeft + colWidths[0] + colWidths[1] + colWidths[2], tableTop + 20)
       .stroke();
    
    // Add table rows
    let y = tableTop + 30;
    let totalValor = 0;
    
    for (const laudoId of pagamento.laudos) {
      // Fetch each laudo with its details
      const laudo = await Laudo.findById(laudoId)
        .populate({
          path: 'exame',
          populate: [
            { path: 'paciente', select: 'nome' },
            { path: 'tipoExame', select: 'nome' }
          ]
        });
      
      if (laudo) {
        const pacienteNome = laudo.exame?.paciente?.nome ? decrypt(laudo.exame.paciente.nome) : 'N/A';
        const exameNome = laudo.exame?.tipoExame?.nome || 'N/A';
        const valor = laudo.valorPago || 0;
        
        totalValor += valor;
        
        doc.text(pacienteNome, tableLeft, y, { width: colWidths[0] });
        doc.text(exameNome, tableLeft + colWidths[0], y, { width: colWidths[1] });
        doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor),
          tableLeft + colWidths[0] + colWidths[1], y, { width: colWidths[2] });
        
        y += 20;
        
        // Add new page if needed
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }
      }
    }
    
    // Add totals
    doc.moveTo(tableLeft, y)
       .lineTo(tableLeft + colWidths[0] + colWidths[1] + colWidths[2], y)
       .stroke();
    
    y += 20;
    doc.font('Helvetica-Bold');
    doc.text('Subtotal:', tableLeft + colWidths[0], y);
    doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalValor),
      tableLeft + colWidths[0] + colWidths[1], y);
    
    y += 20;
    doc.text('Desconto:', tableLeft + colWidths[0], y);
    doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pagamento.valorDesconto),
      tableLeft + colWidths[0] + colWidths[1], y);
    
    y += 20;
    doc.text('Total Pago:', tableLeft + colWidths[0], y);
    doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pagamento.valorFinal),
      tableLeft + colWidths[0] + colWidths[1], y);
    
    y += 40;
    doc.font('Helvetica');
    doc.text(`Forma de pagamento: ${pagamento.meioPagamento}`, tableLeft, y);
    
    if (pagamento.observacoes) {
      y += 20;
      doc.text(`Observações: ${pagamento.observacoes}`, tableLeft, y);
    }
    
    y += 40;
    doc.text(`Registrado por: ${pagamento.registradoPor?.nome || 'Sistema'}`, tableLeft, y);
    
    // Finalize the PDF
    doc.end();
    
  } catch (error) {
    console.error('Erro ao gerar recibo');
    res.status(500).json({ erro: 'Erro ao gerar recibo' });
  }
};

// Dashboard financeiro - LOG DE VISUALIZAÇÃO OPCIONAL
exports.dashboardFinanceiro = async (req, res) => {
  try {
    let { tenantId } = req.query;
    const periodo = req.query.periodo || 'mes'; // mes, trimestre, semestre, ano
    
    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }
    
    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID não disponível' });
    }
    
    // Calcular datas de início e fim com base no período
    const dataFim = new Date();
    const dataInicio = new Date();
    
    switch (periodo) {
      case 'mes':
        dataInicio.setMonth(dataInicio.getMonth() - 1);
        break;
      case 'trimestre':
        dataInicio.setMonth(dataInicio.getMonth() - 3);
        break;
      case 'semestre':
        dataInicio.setMonth(dataInicio.getMonth() - 6);
        break;
      case 'ano':
        dataInicio.setFullYear(dataInicio.getFullYear() - 1);
        break;
      default:
        dataInicio.setMonth(dataInicio.getMonth() - 1);
    }
    
    // Carregar dados do MongoDB
    const Laudo = require('../models/Laudo');
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    
    // 1. Total de laudos no período
    const totalLaudos = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim }
    });
    
    // 2. Total de laudos pagos
    const laudosPagos = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim },
      pagamentoRegistrado: true
    });
    
    // 3. Total de laudos pendentes
    const laudosPendentes = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim },
      pagamentoRegistrado: { $ne: true }
    });
    
    // 4. Valor total recebido
    const pagamentos = await PagamentoLaudo.find({
      tenant_id: tenantId,
      dataPagamento: { $gte: dataInicio, $lte: dataFim }
    });
    
    const valorTotalRecebido = pagamentos.reduce((total, pagamento) => total + (pagamento.valorFinal || 0), 0);
    const valorTotalDescontos = pagamentos.reduce((total, pagamento) => total + (pagamento.valorDesconto || 0), 0);
    
    // 5. Valor médio por laudo
    const valorMedioPorLaudo = laudosPagos > 0 ? valorTotalRecebido / laudosPagos : 0;
    
    // 6. Pagamentos por médico
    const pagamentosPorMedico = await PagamentoLaudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataPagamento: { $gte: dataInicio, $lte: dataFim }
        }
      },
      {
        $lookup: {
          from: 'usuarios',
          localField: 'medicoId',
          foreignField: '_id',
          as: 'medicoInfo'
        }
      },
      {
        $unwind: '$medicoInfo'
      },
      {
        $group: {
          _id: '$medicoId',
          nome: { $first: '$medicoInfo.nome' },
          total: { $sum: '$valorFinal' },
          quantidadePagamentos: { $sum: 1 }
        }
      },
      {
        $sort: { total: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // 7. Laudos por tipo de exame
    const laudosPorTipoExame = await Laudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataAssinatura: { $gte: dataInicio, $lte: dataFim }
        }
      },
      {
        $lookup: {
          from: 'exames',
          localField: 'exame',
          foreignField: '_id',
          as: 'exameInfo'
        }
      },
      {
        $unwind: '$exameInfo'
      },
      {
        $lookup: {
          from: 'tipoexames',
          localField: 'exameInfo.tipoExame',
          foreignField: '_id',
          as: 'tipoExameInfo'
        }
      },
      {
        $unwind: '$tipoExameInfo'
      },
      {
        $group: {
          _id: '$tipoExameInfo._id',
          nome: { $first: '$tipoExameInfo.nome' },
          quantidade: { $sum: 1 },
          valorTotal: { $sum: '$valorPago' }
        }
      },
      {
        $sort: { quantidade: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // 8. Receita por dia nos últimos 30 dias
    const ultimosDias = new Date();
    ultimosDias.setDate(ultimosDias.getDate() - 30);
    
    const receitaPorDia = await PagamentoLaudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataPagamento: { $gte: ultimosDias, $lte: dataFim }
        }
      },
      {
        $group: {
          _id: { 
            $dateToString: { 
              format: '%Y-%m-%d', 
              date: '$dataPagamento' 
            } 
          },
          valorTotal: { $sum: '$valorFinal' },
          quantidade: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // 9. Métodos de pagamento mais utilizados
    const metodosPagamento = await PagamentoLaudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataPagamento: { $gte: dataInicio, $lte: dataFim }
        }
      },
      {
        $group: {
          _id: '$meioPagamento',
          quantidade: { $sum: 1 },
          valorTotal: { $sum: '$valorFinal' }
        }
      },
      {
        $sort: { quantidade: -1 }
      }
    ]);
    
    // 10. Calcular previsão de receita (laudos pendentes * valor médio)
    const laudosPendentesValores = await Laudo.find({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim },
      pagamentoRegistrado: { $ne: true },
      valorPago: { $gt: 0 }
    });
    
    const previsaoReceita = laudosPendentesValores.reduce((total, laudo) => total + (laudo.valorPago || 0), 0);
    
    // Verificar desempenho em relação ao período anterior
    const dataInicioAnterior = new Date(dataInicio);
    const dataFimAnterior = new Date(dataInicio);
    
    // Ajustar datas para o período anterior equivalente
    switch (periodo) {
      case 'mes':
        dataInicioAnterior.setMonth(dataInicioAnterior.getMonth() - 1);
        dataFimAnterior.setDate(dataFimAnterior.getDate() - 1);
        break;
      case 'trimestre':
        dataInicioAnterior.setMonth(dataInicioAnterior.getMonth() - 3);
        dataFimAnterior.setDate(dataFimAnterior.getDate() - 1);
        break;
      case 'semestre':
        dataInicioAnterior.setMonth(dataInicioAnterior.getMonth() - 6);
        dataFimAnterior.setDate(dataFimAnterior.getDate() - 1);
        break;
      case 'ano':
        dataInicioAnterior.setFullYear(dataInicioAnterior.getFullYear() - 1);
        dataFimAnterior.setDate(dataFimAnterior.getDate() - 1);
        break;
    }
    
    const pagamentosAnteriores = await PagamentoLaudo.find({
      tenant_id: tenantId,
      dataPagamento: { $gte: dataInicioAnterior, $lte: dataFimAnterior }
    });
    
    const valorPeriodoAnterior = pagamentosAnteriores.reduce((total, pagamento) => total + (pagamento.valorFinal || 0), 0);
    const crescimentoReceita = valorPeriodoAnterior > 0 
      ? ((valorTotalRecebido - valorPeriodoAnterior) / valorPeriodoAnterior) * 100 
      : 100;
    
    // Montar resposta com todos os dados para o dashboard
    const dashboard = {
      periodo: {
        nome: periodo,
        dataInicio: dataInicio,
        dataFim: dataFim
      },
      indicadores: {
        totalLaudos,
        laudosPagos,
        laudosPendentes,
        valorTotalRecebido,
        valorTotalDescontos,
        valorMedioPorLaudo,
        previsaoReceita,
        crescimentoReceita: parseFloat(crescimentoReceita.toFixed(2))
      },
      desempenho: {
        valorPeriodoAtual: valorTotalRecebido,
        valorPeriodoAnterior,
        crescimento: parseFloat(crescimentoReceita.toFixed(2))
      },
      detalhamento: {
        pagamentosPorMedico,
        laudosPorTipoExame,
        receitaPorDia,
        metodosPagamento
      }
    };

    // **LOG DE VISUALIZAÇÃO OPCIONAL**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.usuario.id,
          action: 'view',
          description: `Consultou dashboard financeiro - Período: ${periodo}`,
          collectionName: 'financeiro',
          documentId: null,
          before: null,
          after: {
            periodo,
            totalLaudos,
            valorTotalRecebido,
            crescimentoReceita: parseFloat(crescimentoReceita.toFixed(2))
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: tenantId
        });
      } catch (auditError) {
        console.error('Erro ao criar log de auditoria');
      }
    }
    
    res.json(dashboard);
  } catch (error) {
    console.error('Erro ao gerar dashboard financeiro');
    res.status(500).json({ erro: 'Erro ao gerar dashboard financeiro' });
  }
};

// Relatórios financeiros - LOG DE EXPORTAÇÃO OPCIONAL
exports.relatorioFinanceiro = async (req, res) => {
  try {
    let { tenantId } = req.query;
    const periodo = req.query.periodo || 'mes'; // mes, trimestre, semestre, ano
    const tipoRelatorio = req.query.tipo || 'completo'; // completo, resumido, analítico
    
    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }
    
    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID não disponível' });
    }
    
    // Calcular datas de início e fim com base no período
    const dataFim = new Date();
    const dataInicio = new Date();
    
    switch (periodo) {
      case 'mes':
        dataInicio.setMonth(dataInicio.getMonth() - 1);
        break;
      case 'trimestre':
        dataInicio.setMonth(dataInicio.getMonth() - 3);
        break;
      case 'semestre':
        dataInicio.setMonth(dataInicio.getMonth() - 6);
        break;
      case 'ano':
        dataInicio.setFullYear(dataInicio.getFullYear() - 1);
        break;
      default:
        dataInicio.setMonth(dataInicio.getMonth() - 1);
    }
    
    // Carregar dados do MongoDB
    const Laudo = require('../models/Laudo');
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    
    // 1. Dados gerais
    const totalLaudos = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim }
    });
    
    const laudosPagos = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim },
      pagamentoRegistrado: true
    });
    
    const laudosPendentes = await Laudo.countDocuments({
      tenant_id: tenantId,
      dataAssinatura: { $gte: dataInicio, $lte: dataFim },
      pagamentoRegistrado: { $ne: true }
    });
    
    // 2. Dados financeiros
    const pagamentos = await PagamentoLaudo.find({
      tenant_id: tenantId,
      dataPagamento: { $gte: dataInicio, $lte: dataFim }
    }).lean();
    
    const valorTotalRecebido = pagamentos.reduce((total, pagamento) => total + (pagamento.valorFinal || 0), 0);
    const valorTotalDescontos = pagamentos.reduce((total, pagamento) => total + (pagamento.valorDesconto || 0), 0);
    const valorBruto = pagamentos.reduce((total, pagamento) => total + (pagamento.valorTotal || 0), 0);
    
    // 3. Dados por mês (para gráfico de tendência)
    const receitaPorMes = await PagamentoLaudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataPagamento: { $gte: dataInicio, $lte: dataFim }
        }
      },
      {
        $group: {
          _id: { 
            ano: { $year: "$dataPagamento" },
            mes: { $month: "$dataPagamento" }
          },
          valorTotal: { $sum: "$valorFinal" },
          quantidade: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.ano": 1, "_id.mes": 1 }
      }
    ]);
    
    // Transformar em array formatado para visualização
    const receitaMensal = receitaPorMes.map(item => ({
      periodo: `${item._id.ano}-${item._id.mes.toString().padStart(2, '0')}`,
      valorTotal: item.valorTotal,
      quantidade: item.quantidade
    }));
    
    // 4. Análise de desempenho (comparação com período anterior)
    const dataInicioAnterior = new Date(dataInicio);
    const dataFimAnterior = new Date(dataInicio);
    const duracaoPeriodo = dataFim.getTime() - dataInicio.getTime();
    
    dataInicioAnterior.setTime(dataInicioAnterior.getTime() - duracaoPeriodo);
    dataFimAnterior.setTime(dataFimAnterior.getTime() - 1);
    
    const pagamentosAnteriores = await PagamentoLaudo.find({
      tenant_id: tenantId,
      dataPagamento: { $gte: dataInicioAnterior, $lte: dataFimAnterior }
    }).lean();
    
    const valorPeriodoAnterior = pagamentosAnteriores.reduce((total, pagamento) => total + (pagamento.valorFinal || 0), 0);
    const crescimentoReceita = valorPeriodoAnterior > 0 
      ? ((valorTotalRecebido - valorPeriodoAnterior) / valorPeriodoAnterior) * 100 
      : 100;
    
    // 5. Listagem detalhada de pagamentos (para relatório analítico)
    let pagamentosDetalhados = [];
    
    if (tipoRelatorio === 'analitico') {
      pagamentosDetalhados = await PagamentoLaudo.find({
        tenant_id: tenantId,
        dataPagamento: { $gte: dataInicio, $lte: dataFim }
      })
      .populate('medicoId', 'nome crm')
      .populate('registradoPor', 'nome')
      .sort({ dataPagamento: -1 })
      .lean();
      
      // Formatar para exibição
      pagamentosDetalhados = pagamentosDetalhados.map(pagamento => ({
        id: pagamento._id,
        medicoNome: pagamento.medicoId?.nome || 'N/A',
        crm: pagamento.medicoId?.crm?.numero || 'N/A',
        dataPagamento: pagamento.dataPagamento,
        valorTotal: pagamento.valorTotal,
        desconto: pagamento.valorDesconto,
        valorFinal: pagamento.valorFinal,
        meioPagamento: pagamento.meioPagamento,
        quantidadeLaudos: pagamento.laudos?.length || 0,
        registradoPor: pagamento.registradoPor?.nome || 'Sistema'
      }));
    }
    
    // Montar resposta com todos os dados para o relatório
    const relatorio = {
      periodo: {
        nome: periodo,
        dataInicio: dataInicio,
        dataFim: dataFim
      },
      resumo: {
        totalLaudos,
        laudosPagos,
        laudosPendentes,
        valorBruto,
        valorDescontos: valorTotalDescontos,
        valorLiquido: valorTotalRecebido,
        taxaConversao: totalLaudos > 0 ? (laudosPagos / totalLaudos * 100).toFixed(2) : 0,
        crescimento: parseFloat(crescimentoReceita.toFixed(2))
      },
      tendencia: receitaMensal,
      analise: {
        valorPeriodoAtual: valorTotalRecebido,
        valorPeriodoAnterior,
        diferenca: valorTotalRecebido - valorPeriodoAnterior,
        crescimentoPercentual: parseFloat(crescimentoReceita.toFixed(2))
      }
    };
    
    // Adicionar detalhes apenas para relatório analítico
    if (tipoRelatorio === 'analitico') {
      relatorio.detalhes = pagamentosDetalhados;
    }

    // **LOG DE EXPORTAÇÃO OPCIONAL**
    if (req.query.audit === 'true') {
      try {
        await AuditLog.create({
          userId: req.usuario.id,
          action: 'export',
          description: `Exportou relatório financeiro - Tipo: ${tipoRelatorio}, Período: ${periodo}`,
          collectionName: 'financeiro',
          documentId: null,
          before: null,
          after: {
            tipoRelatorio,
            periodo,
            totalLaudos,
            valorLiquido: valorTotalRecebido,
            taxaConversao: relatorio.resumo.taxaConversao
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: tenantId
        });
      } catch (auditError) {
        console.error('Erro ao criar log de auditoria');
      }
    }
    
    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório financeiro');
    res.status(500).json({ erro: 'Erro ao gerar relatório financeiro' });
  }
};

// Relatório por médico - SEM AUDITORIA (consulta complexa)
exports.relatorioPorMedico = async (req, res) => {
  try {
    let { tenantId, medicoId } = req.query;
    const periodo = req.query.periodo || 'mes'; // mes, trimestre, semestre, ano
    
    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }
    
    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID não disponível' });
    }
    
    // Calcular datas de início e fim com base no período
    const dataFim = new Date();
    const dataInicio = new Date();
    
    switch (periodo) {
      case 'mes':
        dataInicio.setMonth(dataInicio.getMonth() - 1);
        break;
      case 'trimestre':
        dataInicio.setMonth(dataInicio.getMonth() - 3);
        break;
      case 'semestre':
        dataInicio.setMonth(dataInicio.getMonth() - 6);
        break;
      case 'ano':
        dataInicio.setFullYear(dataInicio.getFullYear() - 1);
        break;
      default:
        dataInicio.setMonth(dataInicio.getMonth() - 1);
    }
    
    // Carregar dados do MongoDB
    const Laudo = require('../models/Laudo');
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    const Usuario = require('../models/Usuario');
    
    // Obter lista de médicos
    let medicos = [];
    
    if (medicoId) {
      // Se foi especificado um médico, buscar apenas ele
      const medico = await Usuario.findOne({
        _id: medicoId,
        tenant_id: tenantId,
        role: 'medico'
      }).lean();
      
      if (medico) {
        medicos = [medico];
      }
    } else {
      // Caso contrário, buscar todos os médicos do tenant
      medicos = await Usuario.find({
        tenant_id: tenantId,
        role: 'medico'
      }).lean();
    }
    
    // Para cada médico, obter os dados financeiros
    const relatoriosPorMedico = await Promise.all(medicos.map(async (medico) => {
      // 1. Total de laudos no período
      const totalLaudos = await Laudo.countDocuments({
        tenant_id: tenantId,
        medicoResponsavelId: medico._id,
        dataAssinatura: { $gte: dataInicio, $lte: dataFim }
      });
      
      // 2. Total de laudos pagos
      const laudosPagos = await Laudo.countDocuments({
        tenant_id: tenantId,
        medicoResponsavelId: medico._id,
        dataAssinatura: { $gte: dataInicio, $lte: dataFim },
        pagamentoRegistrado: true
      });
      
      // 3. Total de laudos pendentes
      const laudosPendentes = await Laudo.countDocuments({
        tenant_id: tenantId,
        medicoResponsavelId: medico._id,
        dataAssinatura: { $gte: dataInicio, $lte: dataFim },
        pagamentoRegistrado: { $ne: true }
      });
      
      // 4. Valor total recebido
      const pagamentos = await PagamentoLaudo.find({
        tenant_id: tenantId,
        medicoId: medico._id,
        dataPagamento: { $gte: dataInicio, $lte: dataFim }
      }).lean();
      
      const valorTotalRecebido = pagamentos.reduce((total, pagamento) => total + (pagamento.valorFinal || 0), 0);
      const valorTotalDescontos = pagamentos.reduce((total, pagamento) => total + (pagamento.valorDesconto || 0), 0);
      
      // 5. Valor médio por laudo
      const valorMedioPorLaudo = laudosPagos > 0 ? valorTotalRecebido / laudosPagos : 0;
      
      // 6. Análise temporal (por mês)
      const receitaPorMes = await PagamentoLaudo.aggregate([
        {
          $match: {
            tenant_id: tenantId,
            medicoId: medico._id,
            dataPagamento: { $gte: dataInicio, $lte: dataFim }
          }
        },
        {
          $group: {
            _id: { 
              ano: { $year: "$dataPagamento" },
              mes: { $month: "$dataPagamento" }
            },
            valorTotal: { $sum: "$valorFinal" },
            quantidade: { $sum: 1 }
          }
        },
        {
          $sort: { "_id.ano": 1, "_id.mes": 1 }
        }
      ]);
      
      // Transformar em array formatado para visualização
      const receitaMensal = receitaPorMes.map(item => ({
        periodo: `${item._id.ano}-${item._id.mes.toString().padStart(2, '0')}`,
        valorTotal: item.valorTotal,
        quantidade: item.quantidade
      }));
      
      // 7. Análise por tipo de exame
      const laudosPorTipoExame = await Laudo.aggregate([
        {
          $match: {
            tenant_id: tenantId,
            medicoResponsavelId: medico._id,
            dataAssinatura: { $gte: dataInicio, $lte: dataFim }
          }
        },
        {
          $lookup: {
            from: 'exames',
            localField: 'exame',
            foreignField: '_id',
            as: 'exameInfo'
          }
        },
        {
          $unwind: '$exameInfo'
        },
        {
          $lookup: {
            from: 'tipoexames',
            localField: 'exameInfo.tipoExame',
            foreignField: '_id',
            as: 'tipoExameInfo'
          }
        },
        {
          $unwind: '$tipoExameInfo'
        },
        {
          $group: {
            _id: '$tipoExameInfo._id',
            nome: { $first: '$tipoExameInfo.nome' },
            quantidade: { $sum: 1 },
            valorTotal: { $sum: '$valorPago' }
          }
        },
        {
          $sort: { quantidade: -1 }
        }
      ]);
      
      return {
        medico: {
          id: medico._id,
          nome: medico.nome,
          crm: medico.crm?.numero || 'N/A',
          especialidade: medico.especialidade?.nome || 'N/A'
        },
        resumo: {
          totalLaudos,
          laudosPagos,
          laudosPendentes,
          valorTotalRecebido,
          valorTotalDescontos,
          valorMedioPorLaudo,
          taxaConversao: totalLaudos > 0 ? (laudosPagos / totalLaudos * 100).toFixed(2) : 0
        },
        tendencia: receitaMensal,
        detalhamento: {
          tiposExame: laudosPorTipoExame
        }
      };
    }));
    
    // Montar resposta com todos os dados para o relatório
    const relatorio = {
      periodo: {
        nome: periodo,
        dataInicio: dataInicio,
        dataFim: dataFim
      },
      medicos: relatoriosPorMedico
    };
    
    // Adicionar resumo consolidado
    if (relatoriosPorMedico.length > 1) {
      const totalLaudos = relatoriosPorMedico.reduce((sum, item) => sum + item.resumo.totalLaudos, 0);
      const laudosPagos = relatoriosPorMedico.reduce((sum, item) => sum + item.resumo.laudosPagos, 0);
      const laudosPendentes = relatoriosPorMedico.reduce((sum, item) => sum + item.resumo.laudosPendentes, 0);
      const valorTotalRecebido = relatoriosPorMedico.reduce((sum, item) => sum + item.resumo.valorTotalRecebido, 0);
      const valorTotalDescontos = relatoriosPorMedico.reduce((sum, item) => sum + item.resumo.valorTotalDescontos, 0);
      
      relatorio.resumoConsolidado = {
        totalLaudos,
        laudosPagos,
        laudosPendentes,
        valorTotalRecebido,
        valorTotalDescontos,
        valorMedioPorLaudo: laudosPagos > 0 ? valorTotalRecebido / laudosPagos : 0,
        taxaConversao: totalLaudos > 0 ? (laudosPagos / totalLaudos * 100).toFixed(2) : 0
      };
    }
    
    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório por médico');
    res.status(500).json({ erro: 'Erro ao gerar relatório por médico' });
  }
};

// Relatório por tipo de exame - SEM AUDITORIA (consulta complexa)
exports.relatorioPorTipoExame = async (req, res) => {
  try {
    let { tenantId, tipoExameId } = req.query;
    const periodo = req.query.periodo || 'mes'; // mes, trimestre, semestre, ano
    
    // Handle tenant_id as array
    if (Array.isArray(req.usuario?.tenant_id)) {
      tenantId = req.usuario.tenant_id[0];
    } else {
      tenantId = req.usuario.isAdminMaster ? tenantId : req.usuario.tenant_id;
    }
    
    if (!tenantId) {
      return res.status(400).json({ erro: 'Tenant ID não disponível' });
    }
    
    // Calcular datas de início e fim com base no período
    const dataFim = new Date();
    const dataInicio = new Date();
    
    switch (periodo) {
      case 'mes':
        dataInicio.setMonth(dataInicio.getMonth() - 1);
        break;
      case 'trimestre':
        dataInicio.setMonth(dataInicio.getMonth() - 3);
        break;
      case 'semestre':
        dataInicio.setMonth(dataInicio.getMonth() - 6);
        break;
      case 'ano':
        dataInicio.setFullYear(dataInicio.getFullYear() - 1);
        break;
      default:
        dataInicio.setMonth(dataInicio.getMonth() - 1);
    }
    
    // Carregar dados do MongoDB
    const Laudo = require('../models/Laudo');
    const TipoExame = require('../models/TipoExame');
    
    // Obter lista de tipos de exame
    let tiposExame = [];
    
    if (tipoExameId) {
      // Se foi especificado um tipo de exame, buscar apenas ele
      const tipoExame = await TipoExame.findOne({
        _id: tipoExameId
      }).lean();
      
      if (tipoExame) {
        tiposExame = [tipoExame];
      }
    } else {
      // Caso contrário, buscar todos os tipos de exame
      tiposExame = await TipoExame.find().lean();
    }
    
    // Analisar laudos por tipo de exame
    const laudosPorTipoExame = await Laudo.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          dataAssinatura: { $gte: dataInicio, $lte: dataFim }
        }
      },
      {
        $lookup: {
          from: 'exames',
          localField: 'exame',
          foreignField: '_id',
          as: 'exameInfo'
        }
      },
      {
        $unwind: '$exameInfo'
      },
      {
        $lookup: {
          from: 'tipoexames',
          localField: 'exameInfo.tipoExame',
          foreignField: '_id',
          as: 'tipoExameInfo'
        }
      },
      {
        $unwind: '$tipoExameInfo'
      },
      {
        $group: {
          _id: '$tipoExameInfo._id',
          nome: { $first: '$tipoExameInfo.nome' },
          totalLaudos: { $sum: 1 },
          laudosPagos: {
            $sum: { $cond: [{ $eq: ['$pagamentoRegistrado', true] }, 1, 0] }
          },
          valorTotal: { $sum: '$valorPago' },
          valorPago: {
            $sum: { $cond: [{ $eq: ['$pagamentoRegistrado', true] }, '$valorPago', 0] }
          }
        }
      },
      {
        $sort: { totalLaudos: -1 }
      }
    ]);
    
    // Calcular estatísticas adicionais
    const relatoriosPorTipoExame = laudosPorTipoExame.map(tipo => {
      const laudosPendentes = tipo.totalLaudos - tipo.laudosPagos;
      const valorMedioPorLaudo = tipo.laudosPagos > 0 ? tipo.valorPago / tipo.laudosPagos : 0;
      const taxaConversao = tipo.totalLaudos > 0 ? (tipo.laudosPagos / tipo.totalLaudos * 100).toFixed(2) : 0;
      const valorPendente = tipo.valorTotal - tipo.valorPago;
      
      return {
        tipoExame: {
          id: tipo._id,
          nome: tipo.nome
        },
        estatisticas: {
          totalLaudos: tipo.totalLaudos,
          laudosPagos: tipo.laudosPagos,
          laudosPendentes,
          valorTotal: tipo.valorTotal,
          valorPago: tipo.valorPago,
          valorPendente,
          valorMedioPorLaudo,
          taxaConversao
        }
      };
    });
    
    // Obter comparativo entre tipos de exame (para gráficos)
    const comparativoTiposExame = {
      labels: relatoriosPorTipoExame.map(item => item.tipoExame.nome),
      totalLaudos: relatoriosPorTipoExame.map(item => item.estatisticas.totalLaudos),
      valorTotal: relatoriosPorTipoExame.map(item => item.estatisticas.valorTotal),
      taxaConversao: relatoriosPorTipoExame.map(item => parseFloat(item.estatisticas.taxaConversao))
    };
    
    // Obter ranking de eficiência (maior taxa de conversão)
    const rankingEficiencia = [...relatoriosPorTipoExame]
      .sort((a, b) => parseFloat(b.estatisticas.taxaConversao) - parseFloat(a.estatisticas.taxaConversao))
      .slice(0, 5)
      .map(item => ({
        nome: item.tipoExame.nome,
        taxaConversao: parseFloat(item.estatisticas.taxaConversao),
        totalLaudos: item.estatisticas.totalLaudos
      }));
    
    // Obter ranking de valor (maior valor médio)
    const rankingValor = [...relatoriosPorTipoExame]
      .sort((a, b) => b.estatisticas.valorMedioPorLaudo - a.estatisticas.valorMedioPorLaudo)
      .slice(0, 5)
      .map(item => ({
        nome: item.tipoExame.nome,
        valorMedio: item.estatisticas.valorMedioPorLaudo,
        totalLaudos: item.estatisticas.totalLaudos
      }));
    
    // Montar resposta com todos os dados para o relatório
    const relatorio = {
      periodo: {
        nome: periodo,
        dataInicio: dataInicio,
        dataFim: dataFim
      },
      tiposExame: relatoriosPorTipoExame,
      comparativo: comparativoTiposExame,
      rankings: {
        eficiencia: rankingEficiencia,
        valor: rankingValor
      }
    };
    
    // Adicionar resumo consolidado
    const totalLaudos = relatoriosPorTipoExame.reduce((sum, item) => sum + item.estatisticas.totalLaudos, 0);
    const laudosPagos = relatoriosPorTipoExame.reduce((sum, item) => sum + item.estatisticas.laudosPagos, 0);
    const laudosPendentes = relatoriosPorTipoExame.reduce((sum, item) => sum + item.estatisticas.laudosPendentes, 0);
    const valorTotal = relatoriosPorTipoExame.reduce((sum, item) => sum + item.estatisticas.valorTotal, 0);
    const valorPago = relatoriosPorTipoExame.reduce((sum, item) => sum + item.estatisticas.valorPago, 0);
    
    relatorio.resumoConsolidado = {
      totalLaudos,
      laudosPagos,
      laudosPendentes,
      valorTotal,
      valorPago,
      valorPendente: valorTotal - valorPago,
      valorMedioPorLaudo: laudosPagos > 0 ? valorPago / laudosPagos : 0,
      taxaConversao: totalLaudos > 0 ? (laudosPagos / totalLaudos * 100).toFixed(2) : 0
    };
    
    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório por tipo de exame');
    res.status(500).json({ erro: 'Erro ao gerar relatório por tipo de exame' });
  }
};

// Listar pagamentos - SEM AUDITORIA (consulta)
exports.listarPagamentos = async (req, res) => {
  try {
    const { page = 1, limit = 20, tenant, medico, dataInicio, dataFim, meioPagamento, medicoId } = req.query;
    
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    
    // Build query
    const query = {};
    
    // AdminMaster can see all payments, others only their tenant
    if (req.usuario.role === 'adminMaster') {
      // AdminMaster can filter by tenant or see all
      if (tenant) {
        query.tenant_id = tenant;
      }
    } else if (req.usuario.role === 'medico' || req.usuario.tipo === 'medico') {
      // Medical professionals can see their own payments from all tenants they are associated with
      const medicoObjectId = req.usuario._id || req.usuario.id;
      
      if (!medicoObjectId) {
        return res.status(400).json({ erro: 'ID do médico não encontrado' });
      }
      
      // Converter para ObjectId se necessário
      const medicoId = mongoose.Types.ObjectId.isValid(medicoObjectId) 
        ? new mongoose.Types.ObjectId(medicoObjectId)
        : medicoObjectId;
        
      query.medicoId = medicoId;
      
      // Para médicos, incluir todos os tenants que ele tem acesso
      if (req.usuario.tenant_id) {
        const tenantIds = Array.isArray(req.usuario.tenant_id) 
          ? req.usuario.tenant_id 
          : [req.usuario.tenant_id];
                
        // Se o médico tem acesso a múltiplos tenants, buscar em todos
        if (tenantIds.length > 1) {
          query.tenant_id = { $in: tenantIds };
        } else {
          query.tenant_id = tenantIds[0];
        }
      }
    } else {
      // Admin/recepcionista can only see their own tenant
      const tenant_id = Array.isArray(req.usuario?.tenant_id) 
        ? req.usuario.tenant_id[0] 
        : req.usuario?.tenant_id;
      
      if (!tenant_id) {
        return res.status(400).json({ erro: 'Tenant ID não disponível' });
      }
      
      query.tenant_id = tenant_id;
    }
    
    // Apply filters (only if not a medico, as medicos are already filtered by their ID)
    if ((medico || medicoId) && req.usuario.role !== 'medico') {
      query.medicoId = medico || medicoId;
    }
    
    if (meioPagamento) {
      query.meioPagamento = meioPagamento;
    }
    
    if (dataInicio || dataFim) {
      query.dataPagamento = {};
      if (dataInicio) {
        query.dataPagamento.$gte = new Date(dataInicio);
      }
      if (dataFim) {
        const endDate = new Date(dataFim);
        endDate.setHours(23, 59, 59, 999);
        query.dataPagamento.$lte = endDate;
      }
    }
        
    const skip = (page - 1) * limit;
    
    // Get paginated payments with population
    const [pagamentos, total] = await Promise.all([
      PagamentoLaudo.find(query)
        .populate('tenant_id', 'nomeFantasia nome')
        .populate('medicoId', 'nome')
        .populate('registradoPor', 'nome')
        .populate({
          path: 'laudos',
          populate: [
            {
              path: 'exame',
              populate: [
                { path: 'paciente', select: 'nome' },
                { path: 'tipoExame', select: 'nome' }
              ]
            }
          ]
        })
        .sort({ dataPagamento: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      PagamentoLaudo.countDocuments(query)
    ]);
    
    // Helper function to map payment method to display format
    const mapMeioPagamento = (meioPagamento) => {
      const mapeamento = {
        'pix': 'PIX',
        'transferencia': 'Transferência bancária',
        'dinheiro': 'Dinheiro',
        'cheque': 'Cheque',
        'cartao': 'Cartão',
        'outros': 'Outros'
      };
      return mapeamento[meioPagamento] || meioPagamento || 'N/A';
    };

    // Format payments data for frontend
    const pagamentosFormatados = pagamentos.map(pagamento => {
      const pagamentoObj = pagamento.toObject();
      return {
        _id: pagamentoObj._id,
        dataPagamento: pagamentoObj.dataPagamento,
        medicoId: pagamentoObj.medicoId?._id,
        medicoNome: pagamentoObj.medicoId?.nome || 'N/A', // Getter já descriptografa
        valorTotal: pagamentoObj.valorTotal || 0,
        valorDesconto: pagamentoObj.valorDesconto || 0,
        valorFinal: pagamentoObj.valorFinal || 0,
        meioPagamento: mapMeioPagamento(pagamentoObj.meioPagamento),
        observacoes: pagamentoObj.observacoes,
        registradorNome: pagamentoObj.registradoPor?.nome || 'N/A', // Getter já descriptografa
        laudos: pagamentoObj.laudos || [],
        laudosDetalhes: pagamentoObj.laudos?.map(laudo => ({
          _id: laudo._id,
          pacienteNome: laudo.exame?.paciente?.nome || 'N/A', // Getter já descriptografa
          tipoExameNome: laudo.exame?.tipoExame?.nome || 'N/A',
          dataAssinatura: laudo.dataAssinatura,
          valorPago: laudo.valorPago || 0
        })) || [],
        tenant_id: pagamentoObj.tenant_id
      };
    });
    
    const totalPages = Math.ceil(total / limit);
    
    const resumo = {
      totalPagamentos: total,
      valorTotal: pagamentos.reduce((sum, p) => sum + (p.valorTotal || 0), 0),
      valorDescontos: pagamentos.reduce((sum, p) => sum + (p.valorDesconto || 0), 0),
      valorLiquido: pagamentos.reduce((sum, p) => sum + (p.valorFinal || 0), 0)
    };
        
    res.json({
      pagamentos: pagamentosFormatados,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
      resumo
    });
  } catch (error) {
    console.error('Erro ao listar pagamentos');
    res.status(500).json({ erro: 'Erro ao listar pagamentos' });
  }
};

// Add this function for payment statistics
exports.obterEstatisticasPagamentos = async (req, res) => {
  try {
    const PagamentoLaudo = require('../models/PagamentoLaudo');
    const Laudo = require('../models/Laudo');
    
    // Get total payments count
    const totalPagamentos = await PagamentoLaudo.countDocuments();
    
    // Get total volume
    const volumeTotal = await PagamentoLaudo.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$valorFinal' }
        }
      }
    ]);
    
    // Get average payment value
    const valorMedio = await PagamentoLaudo.aggregate([
      {
        $group: {
          _id: null,
          media: { $avg: '$valorFinal' }
        }
      }
    ]);
    
    // Get count of active tenants with payments
    const empresasAtivas = await PagamentoLaudo.distinct('tenant_id');
    
    const estatisticas = {
      totalPagamentos,
      volumeTotal: volumeTotal[0]?.total || 0,
      valorMedio: valorMedio[0]?.media || 0,
      empresasAtivas: empresasAtivas.length
    };
    
    res.json(estatisticas);
  } catch (error) {
    console.error('Erro ao obter estatísticas de pagamentos');
    res.status(500).json({ erro: 'Erro ao obter estatísticas de pagamentos' });
  }
};