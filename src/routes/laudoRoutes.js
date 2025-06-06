const express = require('express');
const laudoController = require('../controllers/laudoController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware} = require('../middleware/autorizacaoMiddleware');
const upload = require('../utils/multerConfig');
const { auditLog } = require('../middleware/auditMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const path = require('path');

const router = express.Router();

// Criação do laudo já assinado
router.post(
  '/',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  laudoController.criarLaudo
);

// Refazer Laudo (se desejar, adapte para gerar PDF assinado também)
router.post(
  '/:id/refazer',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  laudoController.refazerLaudo
);

// Histórico de Versões
router.get(
  '/:id/historico',
  authMiddleware,
  tenantMiddleware,
  laudoController.getHistoricoLaudo
);

// Listar Laudos
router.get(
  '/',
  authMiddleware,
  tenantMiddleware,
  laudoController.listarLaudos
);

router.get(
  '/pacientes/:id',
  authMiddleware,
  tenantMiddleware,
  laudoController.listarLaudosPorPaciente
);

// Obter Laudo por ID
router.get(
  '/:id',
  authMiddleware,
  tenantMiddleware,
  laudoController.obterLaudo
);

// Geração de PDF
router.get(
  '/:id/pdf',
  authMiddleware,
  tenantMiddleware,
  laudoController.gerarPdfLaudo
);

// Download de Laudos
router.get(
    '/:id/download/original',
    authMiddleware,
    tenantMiddleware,
    laudoController.downloadLaudoOriginal
  );
  
  router.get(
    '/:id/download/assinado',
    authMiddleware,
    tenantMiddleware,
    laudoController.downloadLaudoAssinado
  );

// Estatísticas e Relatórios
router.get(
  '/estatisticas',
  authMiddleware,
  tenantMiddleware,
  laudoController.getEstatisticas
);

router.get(
  '/relatorio-status',
  authMiddleware,
  tenantMiddleware,
  laudoController.getLaudosPorStatus
);

// Laudos por Exame
router.get(
  '/exame/:id',
  authMiddleware,
  tenantMiddleware,
  laudoController.getLaudosPorExame
);

// Adicione esta rota
router.post('/:id/enviar-email', authMiddleware, tenantMiddleware, laudoController.enviarEmailLaudo);

router.get('/laudos/:path(*)/download', (req, res) => {
    const filePath = path.join(__dirname, '../..', req.params.path);
    res.sendFile(filePath);
  });

router.get('/publico/:id', laudoController.visualizarLaudoPublico);
router.post('/publico/:id/auth', laudoController.autenticarLaudoPublico);

router.patch('/laudos/:id/invalidar', authMiddleware, tenantMiddleware, laudoController.invalidarLaudo);

router.get('/reports/laudos', authMiddleware, tenantMiddleware, laudoController.gerarRelatorio);

router.get('/relatorios/exportar-pdf', authMiddleware, tenantMiddleware, laudoController.relatorioPdf);

module.exports = router;