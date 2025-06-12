const express = require('express');
const laudoController = require('../controllers/laudoController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware} = require('../middleware/autorizacaoMiddleware');
const upload = require('../utils/multerConfig');
const { auditLog } = require('../middleware/auditMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');
const AuditLog = require('../models/AuditModel');
const path = require('path');
const { body, validationResult } = require('express-validator');

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
router.get('/publico/:id/pdf', laudoController.gerarPdfLaudoPublico);
router.post('/publico/:id/auth', laudoController.autenticarLaudoPublico);

router.patch('/laudos/:id/invalidar', authMiddleware, tenantMiddleware, laudoController.invalidarLaudo);

router.get('/reports/laudos', authMiddleware, tenantMiddleware, laudoController.gerarRelatorio);

router.get('/relatorios/exportar-pdf', authMiddleware, tenantMiddleware, laudoController.relatorioPdf);

// Assinar laudo automaticamente (quando o médico confirma no modal)
router.post('/:id/assinar-automaticamente',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  laudoController.assinarLaudoAutomaticamente
);

// Assinar laudo manualmente (botão na página de detalhes)
router.post('/:id/assinar-manual',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  laudoController.assinarLaudoManual
);

// Upload de laudo assinado pelo médico
router.post('/:id/upload-assinado',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  upload.single('signedFile'),
  laudoController.uploadLaudoAssinado
);

// Assinar laudo com certificado digital do médico
router.post('/:id/assinar-com-certificado',
  authMiddleware,
  tenantMiddleware,
  autorizacaoMiddleware(['medico']),
  body('senhaCertificado').notEmpty().withMessage('Senha do certificado é obrigatória'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { senhaCertificado } = req.body;
      const medicoId = req.usuario.id;

      const resultado = await laudoController.assinarLaudoComCertificado(
        id, 
        medicoId, 
        senhaCertificado
      );

      // Log de auditoria
      try {
        await AuditLog.create({
          userId: medicoId,
          action: 'update',
          description: `Laudo assinado digitalmente com certificado: ${resultado.certificadoNome}`,
          collectionName: 'laudos',
          documentId: id,
          before: { status: 'Laudo realizado' },
          after: { 
            status: 'Laudo assinado',
            assinadoCom: resultado.assinadoCom,
            certificadoId: resultado.certificadoId
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          tenant_id: req.usuario.tenant_id
        });
      } catch (auditError) {
        console.error('Erro ao criar log de auditoria:', auditError);
      }

      res.json({
        sucesso: true,
        mensagem: 'Laudo assinado digitalmente com sucesso',
        laudo: {
          id,
          status: 'Laudo assinado',
          laudoAssinado: resultado.fileUrl,
          certificadoUtilizado: resultado.certificadoNome,
          dataAssinatura: new Date()
        }
      });

    } catch (error) {
      console.error('Erro ao assinar laudo com certificado:', error);
      
      let statusCode = 500;
      let mensagemErro = 'Erro interno do servidor';

      if (error.message.includes('Senha') || error.message.includes('incorreta')) {
        statusCode = 400;
        mensagemErro = 'Senha do certificado incorreta';
      } else if (error.message.includes('não encontrado')) {
        statusCode = 404;
        mensagemErro = error.message;
      } else if (error.message.includes('vencido')) {
        statusCode = 400;
        mensagemErro = 'Certificado vencido. Cadastre um novo certificado';
      }

      res.status(statusCode).json({ 
        erro: mensagemErro,
        detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

module.exports = router;