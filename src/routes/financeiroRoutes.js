/* financeiroRoutes.js */
const express = require('express');
const router = express.Router();
const financeiroController = require('../controllers/financeiroController');
const valorLaudoController = require('../controllers/valorLaudoController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware, verificarAcessoTenant} = require('../middleware/autorizacaoMiddleware');

// Todas as rotas precisam de autenticação
router.use(authMiddleware);

// Add this route for payment statistics (AdminMaster only)
router.get('/pagamentos/estatisticas',
  autorizacaoMiddleware(['adminMaster']),
  financeiroController.obterEstatisticasPagamentos
);

// Add this route for listing all payments (AdminMaster only)  
router.get('/pagamentos',
  autorizacaoMiddleware(['adminMaster', 'admin']),
  financeiroController.listarPagamentos
);

// Rotas com verificação de tenant
router.get('/laudos-medico', 
  verificarAcessoTenant,
  financeiroController.listarLaudosPorMedico
);

router.post('/pagamentos',
  verificarAcessoTenant,
  financeiroController.registrarPagamento
);

// Dashboard financeiro
router.get('/dashboard', 
  autorizacaoMiddleware(['adminMaster', 'admin']),
  financeiroController.dashboardFinanceiro
);

// Relatórios financeiros
router.get('/relatorios', 
  autorizacaoMiddleware(['adminMaster', 'admin']),
  financeiroController.relatorioFinanceiro
);

// Relatório por médico
router.get('/relatorios/medicos', 
  autorizacaoMiddleware(['adminMaster', 'admin']),
  financeiroController.relatorioPorMedico
);

// Relatório por tipo de exame
router.get('/relatorios/tipos-exame', 
  autorizacaoMiddleware(['adminMaster', 'admin']),
  financeiroController.relatorioPorTipoExame
);

// Exportar relatórios (placeholder - implementar conforme necessário)
router.get('/relatorios/export', 
  autorizacaoMiddleware(['adminMaster', 'admin']),
  (req, res) => {
    res.status(501).json({ erro: 'Funcionalidade de exportação não implementada ainda' });
  }
);

// Configurações financeiras (placeholder - implementar conforme necessário)
router.get('/configuracoes',
  autorizacaoMiddleware(['adminMaster']),
  (req, res) => {
    res.json({
      valorMinimoLaudo: 50,
      descontoMaximo: 20,
      acrescimoUrgencia: 50,
      emailsRelatorio: '',
      frequenciaRelatorio: 'mensal',
      dataCorteRelatorio: 30,
      calcularValorAutomatico: true,
      permitirDescontos: true,
      exigirJustificativaDesconto: true,
      bloquearLaudoSemValor: false,
      notificarValorAlto: true,
      limiteNotificacaoValor: 1000,
      notificarDescontoAlto: true,
      limiteNotificacaoDesconto: 20
    });
  }
);

router.put('/configuracoes',
  autorizacaoMiddleware(['adminMaster']),
  (req, res) => {
    // Implementar salvamento das configurações
    res.json({ mensagem: 'Configurações salvas com sucesso' });
  }
);

// Add this route for the receipt generator
router.get('/recibo/:id',
  authMiddleware,
  financeiroController.gerarRecibo
);

module.exports = router;