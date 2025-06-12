/* financeiroRoutes.js */
const express = require('express');
const router = express.Router();
const financeiroController = require('../controllers/financeiroController');
const valorLaudoController = require('../controllers/valorLaudoController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware, verificarAcessoTenant} = require('../middleware/autorizacaoMiddleware');
const {verificarPermissaoFinanceiro} = require('../middleware/financeiroMiddleware');

// Todas as rotas precisam de autenticação
router.use(authMiddleware);

// Add this route for payment statistics (AdminMaster only)
router.get('/pagamentos/estatisticas',
  autorizacaoMiddleware(['adminMaster']),
  financeiroController.obterEstatisticasPagamentos
);

// Add this route for listing all payments (AdminMaster, Admin, and Medical professionals can access their own)  
router.get('/pagamentos',
  authMiddleware,
  verificarAcessoTenant,
  (req, res, next) => {
    // Only apply financial permission check for admin roles, not for medical professionals
    if (req.usuario.role === 'medico') {
      return next();
    }
    return verificarPermissaoFinanceiro(req, res, next);
  },
  financeiroController.listarPagamentos
);

// Rotas com verificação de tenant
router.get('/laudos-medico', 
  authMiddleware,
  verificarAcessoTenant,
  verificarPermissaoFinanceiro,
  financeiroController.listarLaudosPorMedico
);

router.post('/pagamentos',
  authMiddleware,
  verificarAcessoTenant,
  verificarPermissaoFinanceiro,
  financeiroController.registrarPagamento
);

// Dashboard financeiro
router.get('/dashboard', 
  authMiddleware,
  autorizacaoMiddleware(['adminMaster', 'admin']),
  verificarPermissaoFinanceiro,
  financeiroController.dashboardFinanceiro
);

// Relatórios financeiros
router.get('/relatorios', 
  authMiddleware,
  verificarAcessoTenant,
  verificarPermissaoFinanceiro,
  financeiroController.relatorioFinanceiro
);

// Relatório por médico
router.get('/relatorios/medicos', 
  authMiddleware,
  verificarAcessoTenant,
  verificarPermissaoFinanceiro,
  financeiroController.relatorioPorMedico
);

// Relatório por tipo de exame
router.get('/relatorios/tipos-exame', 
  authMiddleware,
  verificarAcessoTenant,
  verificarPermissaoFinanceiro,
  financeiroController.relatorioPorTipoExame
);

// Exportar relatórios (placeholder - implementar conforme necessário)
router.get('/relatorios/export', 
  authMiddleware,
  verificarPermissaoFinanceiro,
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