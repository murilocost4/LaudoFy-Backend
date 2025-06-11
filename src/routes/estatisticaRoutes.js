// routes/estatisticas.js
const express = require('express');
const router = express.Router();
const Laudo = require('../models/Laudo');
const Exame = require('../models/Exame');
const { decrypt } = require('../utils/crypto');
const authMiddleware = require('../middleware/authMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const { startOfMonth, endOfMonth, subDays } = require('date-fns');

// Estatísticas Gerais
router.get('/estatisticas', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const now = new Date();
        const startOfThisMonth = startOfMonth(now);
        const endOfThisMonth = endOfMonth(now);
        const thirtyDaysAgo = subDays(now, 30);

        // Get all exams for processing
        const todosExames = await Exame.find({ 
            tenant_id: req.tenant_id,
            createdAt: { $gte: thirtyDaysAgo }
        }).lean();
        
        // Process status manually
        let totalExames = 0;
        let examesPendentes = 0;
        let examesFinalizados = 0;
        let examesTotalMes = 0;
        let examesFinalizadosMes = 0;
        
        todosExames.forEach(exame => {
            totalExames++;
            
            // Decrypt status
            let status;
            try {
                status = decrypt(exame.status);
            } catch (err) {
                status = exame.status;
            }
            
            if (status === 'Pendente') examesPendentes++;
            if (status === 'Laudo realizado') examesFinalizados++;

            // Check if exam is from current month
            const examDate = new Date(exame.createdAt);
            if (examDate >= startOfThisMonth && examDate <= endOfThisMonth) {
                examesTotalMes++;
                if (status === 'Laudo realizado') examesFinalizadosMes++;
            }
        });

        // Calculate average response time
        const tempoMedioResposta = await Laudo.aggregate([
            {
                $match: {
                    tenant_id: req.tenant_id,
                    dataFinalizacao: { $exists: true },
                    dataCriacao: { $exists: true }
                }
            },
            {
                $group: {
                    _id: null,
                    avgTime: { 
                        $avg: { 
                            $subtract: ["$dataFinalizacao", "$dataCriacao"] 
                        } 
                    }
                }
            }
        ]);

        // Calculate completion rate
        const taxaConclusao = totalExames > 0 ? (examesFinalizados / totalExames) * 100 : 0;

        // Get trend data
        const tendencia = await Exame.aggregate([
            {
                $match: {
                    tenant_id: req.tenant_id,
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { "_id": 1 }
            }
        ]);

        res.json({
            totalExames,
            examesPendentes,
            examesFinalizados,
            examesTotalMes,
            examesFinalizadosMes,
            tempoMedioResposta: tempoMedioResposta[0]?.avgTime || 0,
            taxaConclusao: Math.round(taxaConclusao * 100) / 100,
            tendencia: tendencia.map(item => ({
                data: item._id,
                total: item.count
            }))
        });
    } catch (err) {
        console.error('Erro ao obter estatísticas');
        res.status(500).json({ 
            message: 'Erro ao processar estatísticas'
        });
    }
});

// Distribuição de Tipos de Exame
router.get('/tipos-exames', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const exames = await Exame.find({ tenant_id: req.tenant_id })
            .populate('tipoExame', 'nome')
            .select('tipoExame');
        
        const tiposContagem = exames.reduce((acc, exame) => {
            if (!exame.tipoExame) return acc;
            
            const tipoNome = exame.tipoExame.nome;
            if (!acc[tipoNome]) {
                acc[tipoNome] = 0;
            }
            acc[tipoNome]++;
            return acc;
        }, {});
        
        const tipos = Object.entries(tiposContagem)
            .map(([tipo, count]) => ({ _id: tipo, count }))
            .sort((a, b) => b.count - a.count);
        
        res.json(tipos);
    } catch (err) {
        console.error('Erro ao obter tipos de exame');
        res.status(500).json({ 
            message: 'Erro ao processar tipos de exame'
        });
    }
});

// Evolução Mensal
router.get('/evolucao-mensal', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const evolucao = await Exame.aggregate([
            {
                $match: {
                    tenant_id: req.tenant_id
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$dataExame" },
                        month: { $month: "$dataExame" }
                    },
                    total: { $sum: 1 },
                    concluidos: {
                        $sum: { $cond: [{ $eq: ["$status", "Laudo realizado"] }, 1, 0] }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            { $limit: 12 }
        ]);

        res.json(evolucao);
    } catch (err) {
        console.error('Erro ao obter evolução mensal');
        res.status(500).json({ message: 'Erro ao processar evolução mensal' });
    }
});

// Performance por Médico
router.get('/performance-medicos', authMiddleware, tenantMiddleware, async (req, res) => {
    try {
        const performance = await Laudo.aggregate([
            {
                $match: {
                    tenant_id: req.tenant_id,
                    dataFinalizacao: { $exists: true }
                }
            },
            {
                $group: {
                    _id: "$medicoResponsavelId",
                    totalLaudos: { $sum: 1 },
                    tempoMedio: {
                        $avg: {
                            $subtract: ["$dataFinalizacao", "$dataCriacao"]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "usuarios",
                    localField: "_id",
                    foreignField: "_id",
                    as: "medico"
                }
            },
            {
                $unwind: "$medico"
            },
            {
                $project: {
                    nome: "$medico.nome",
                    totalLaudos: 1,
                    tempoMedioHoras: {
                        $divide: ["$tempoMedio", 3600000] // Convert to hours
                    }
                }
            }
        ]);

        res.json(performance);
    } catch (err) {
        console.error('Erro ao obter performance dos médicos');
        res.status(500).json({ message: 'Erro ao processar performance dos médicos' });
    }
});

module.exports = router;