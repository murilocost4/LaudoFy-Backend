const Laudo = require('../models/Laudo');
const Usuario = require('../models/Usuario');
const Exame = require('../models/Exame');
const TipoExame = require('../models/TipoExame');
const PagamentoLaudo = require('../models/PagamentoLaudo');
const mongoose = require('mongoose');

exports.getDashboardData = async (req, res) => {
  try {
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

    // Calcular datas para diferentes períodos
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    const ultimos7Dias = new Date(hoje.getTime() - (7 * 24 * 60 * 60 * 1000));
    const ultimos30Dias = new Date(hoje.getTime() - (30 * 24 * 60 * 60 * 1000));

    // 1. ESTATÍSTICAS PRINCIPAIS - LAUDOS
    const [
      totalLaudos,
      laudosHoje,
      laudosSemana,
      laudosMes,
      laudosPendentes,
      laudosAssinados,
      laudosRevisao,
      laudosRejeitados
    ] = await Promise.all([
      Laudo.countDocuments({ tenant_id: tenantId }),
      Laudo.countDocuments({ 
        tenant_id: tenantId, 
        createdAt: { 
          $gte: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()),
          $lt: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)
        }
      }),
      Laudo.countDocuments({ tenant_id: tenantId, createdAt: { $gte: ultimos7Dias } }),
      Laudo.countDocuments({ tenant_id: tenantId, createdAt: { $gte: inicioMes } }),
      Laudo.countDocuments({ tenant_id: tenantId, status: 'Pendente' }),
      Laudo.countDocuments({ tenant_id: tenantId, status: 'Assinado' }),
      Laudo.countDocuments({ tenant_id: tenantId, status: 'Em Revisão' }),
      Laudo.countDocuments({ tenant_id: tenantId, status: 'Rejeitado' })
    ]);

    // 2. ESTATÍSTICAS DE EXAMES (usando apenas status válidos)
    const [
      totalExames,
      examesPendentes,
      examesConcluidos,
      exameslaudoRealizado,
      examesCancelados
    ] = await Promise.all([
      Exame.countDocuments({ tenant_id: tenantId }),
      Exame.countDocuments({ tenant_id: tenantId, status: 'Pendente' }),
      Exame.countDocuments({ tenant_id: tenantId, status: 'Concluído' }),
      Exame.countDocuments({ tenant_id: tenantId, status: 'Laudo realizado' }),
      Exame.countDocuments({ tenant_id: tenantId, status: 'Cancelado' })
    ]);

    // 3. PRODUTIVIDADE DOS MÉDICOS
    const produtividadeMedicos = await Laudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          createdAt: { $gte: inicioMes }
        }
      },
      {
        $group: {
          _id: '$medicoResponsavelId',
          totalLaudos: { $sum: 1 },
          laudosAssinados: {
            $sum: { $cond: [{ $eq: ['$status', 'Assinado'] }, 1, 0] }
          },
          laudosPendentes: {
            $sum: { $cond: [{ $eq: ['$status', 'Pendente'] }, 1, 0] }
          },
          tempoMedioResposta: { $avg: '$tempoResposta' }
        }
      },
      {
        $lookup: {
          from: 'usuarios',
          localField: '_id',
          foreignField: '_id',
          as: 'medico'
        }
      },
      {
        $unwind: { 
          path: '$medico',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: {
          'medico._id': { $exists: true }
        }
      },
      {
        $sort: { totalLaudos: -1 }
      },
      {
        $limit: 10
      },
      {
        $project: {
          nome: '$medico.nome',
          totalLaudos: 1,
          laudosAssinados: 1,
          laudosPendentes: 1,
          taxaAssinatura: {
            $cond: {
              if: { $gt: ['$totalLaudos', 0] },
              then: {
                $multiply: [
                  { $divide: ['$laudosAssinados', '$totalLaudos'] },
                  100
                ]
              },
              else: 0
            }
          },
          tempoMedioResposta: { $ifNull: [{ $round: ['$tempoMedioResposta', 2] }, 0] }
        }
      }
    ]);

    // 4. TIPOS DE EXAME MAIS REALIZADOS
    const tiposExameMaisRealizados = await Laudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          createdAt: { $gte: inicioMes }
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
        $unwind: { 
          path: '$exameInfo',
          preserveNullAndEmptyArrays: true
        }
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
        $unwind: { 
          path: '$tipoExameInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $match: {
          'tipoExameInfo._id': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$tipoExameInfo._id',
          nome: { $first: '$tipoExameInfo.nome' },
          quantidade: { $sum: 1 },
          pendentes: {
            $sum: { $cond: [{ $eq: ['$status', 'Pendente'] }, 1, 0] }
          },
          assinados: {
            $sum: { $cond: [{ $eq: ['$status', 'Assinado'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { quantidade: -1 }
      },
      {
        $limit: 8
      }
    ]);

    // 5. EVOLUÇÃO DIÁRIA DE LAUDOS (baseado na data de criação)
    const evolucaoDiariaLaudos = await Laudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          createdAt: { $gte: ultimos30Dias }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          total: { $sum: 1 },
          assinados: {
            $sum: { $cond: [{ $eq: ['$status', 'Assinado'] }, 1, 0] }
          },
          pendentes: {
            $sum: { $cond: [{ $eq: ['$status', 'Pendente'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // 6. TEMPO MÉDIO DE PROCESSAMENTO
    const tempoMedioProcessamento = await Laudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          status: 'Assinado',
          dataAssinatura: { $exists: true, $ne: null },
          createdAt: { $gte: inicioMes }
        }
      },
      {
        $addFields: {
          tempoProcessamento: {
            $subtract: ['$dataAssinatura', '$createdAt']
          }
        }
      },
      {
        $group: {
          _id: null,
          tempoMedio: { 
            $avg: { 
              $divide: ['$tempoProcessamento', 1000 * 60 * 60] // Converter para horas
            } 
          },
          tempoMinimo: { 
            $min: { 
              $divide: ['$tempoProcessamento', 1000 * 60 * 60] 
            } 
          },
          tempoMaximo: { 
            $max: { 
              $divide: ['$tempoProcessamento', 1000 * 60 * 60] 
            } 
          }
        }
      }
    ]);

    // 7. DADOS FINANCEIROS (RESUMIDOS)
    const resumoFinanceiro = await PagamentoLaudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          dataPagamento: { $gte: inicioMes }
        }
      },
      {
        $group: {
          _id: null,
          faturamentoMes: { $sum: '$valorFinal' },
          quantidadePagamentos: { $sum: 1 },
          ticketMedio: { $avg: '$valorFinal' }
        }
      }
    ]);

    // Valor em aberto
    const valorEmAberto = await Laudo.aggregate([
      {
        $match: {
          tenant_id: new mongoose.Types.ObjectId(tenantId),
          pagamentoRegistrado: { $ne: true },
          status: 'Assinado',
          valorPago: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$valorPago' },
          quantidade: { $sum: 1 }
        }
      }
    ]);

    // 8. LAUDOS RECENTES COM MAIS DETALHES
    const laudosRecentes = await Laudo.find({
      tenant_id: tenantId
    })
    .populate({
      path: 'exame',
      populate: [
        { path: 'paciente', select: 'nome idade sexo' },
        { path: 'tipoExame', select: 'nome' }
      ]
    })
    .populate('medicoResponsavelId', 'nome crm')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

    // 9. LAUDOS URGENTES (Pendentes há mais de 24h)
    const laudosUrgentes = await Laudo.find({
      tenant_id: tenantId,
      status: 'Pendente',
      createdAt: { $lt: new Date(hoje.getTime() - (24 * 60 * 60 * 1000)) }
    })
    .populate({
      path: 'exame',
      populate: [
        { path: 'paciente', select: 'nome' },
        { path: 'tipoExame', select: 'nome' }
      ]
    })
    .populate('medicoResponsavelId', 'nome')
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();

    // 10. ALERTAS E NOTIFICAÇÕES
    const alertas = [];
    
    if (laudosUrgentes.length > 0) {
      alertas.push({
        tipo: 'danger',
        titulo: 'Laudos Urgentes',
        mensagem: `${laudosUrgentes.length} laudos pendentes há mais de 24h`,
        acao: '/laudos?status=urgente'
      });
    }

    if (laudosPendentes > 20) {
      alertas.push({
        tipo: 'warning',
        titulo: 'Muitos Laudos Pendentes',
        mensagem: `${laudosPendentes} laudos aguardando assinatura`,
        acao: '/laudos?status=pendente'
      });
    }

    if (examesPendentes > 15) {
      alertas.push({
        tipo: 'info',
        titulo: 'Exames Pendentes',
        mensagem: `${examesPendentes} exames aguardando processamento`,
        acao: '/exames?status=pendente'
      });
    }

    // Comparação com mês anterior
    const laudosMesAnterior = await Laudo.countDocuments({
      tenant_id: tenantId,
      createdAt: { $gte: inicioMesAnterior, $lte: fimMesAnterior }
    });

    const crescimentoLaudos = laudosMesAnterior > 0 
      ? ((laudosMes - laudosMesAnterior) / laudosMesAnterior) * 100 
      : laudosMes > 0 ? 100 : 0;

    // Montar resposta
    const dashboardData = {
      estatisticas: {
        // Laudos
        totalLaudos,
        laudosHoje,
        laudosSemana,
        laudosMes,
        laudosPendentes,
        laudosAssinados,
        laudosRevisao,
        laudosRejeitados,
        crescimentoLaudos: parseFloat(crescimentoLaudos.toFixed(2)),
        
        // Exames (usando status válidos)
        totalExames,
        examesPendentes,
        examesAndamento: exameslaudoRealizado, // Usando "Laudo realizado" no lugar de "Em Andamento"
        examesConcluidos,
        examesCancelados,
        
        // Performance
        tempoMedioProcessamento: tempoMedioProcessamento[0]?.tempoMedio?.toFixed(1) || 0,
        tempoMinimoProcessamento: tempoMedioProcessamento[0]?.tempoMinimo?.toFixed(1) || 0,
        tempoMaximoProcessamento: tempoMedioProcessamento[0]?.tempoMaximo?.toFixed(1) || 0
      },
      
      financeiro: {
        faturamentoMes: resumoFinanceiro[0]?.faturamentoMes || 0,
        ticketMedio: resumoFinanceiro[0]?.ticketMedio || 0,
        valorEmAberto: valorEmAberto[0]?.total || 0,
        laudosParaPagar: valorEmAberto[0]?.quantidade || 0
      },
      
      graficos: {
        evolucaoDiariaLaudos: evolucaoDiariaLaudos.map(item => ({
          data: item._id,
          total: item.total,
          assinados: item.assinados,
          pendentes: item.pendentes
        })),
        produtividadeMedicos,
        tiposExameMaisRealizados
      },
      
      laudosRecentes,
      laudosUrgentes,
      alertas
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Erro ao carregar dashboard');
    res.status(500).json({ 
      erro: 'Erro ao carregar dados do dashboard',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};