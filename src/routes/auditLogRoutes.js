const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware} = require('../middleware/autorizacaoMiddleware');
const validacoes = require('../validations/auditLogValidations');
const tenantMiddleware = require('../middleware/tenantMiddleware');

// Admin Master Routes - Global audit logs across all tenants
router.get(
    '/adminmaster/audit',
    authMiddleware,
    autorizacaoMiddleware(['adminMaster']),
    validacoes.validarListagem,
    auditLogController.listarAuditoriaGlobal
);

router.get(
    '/adminmaster/audit/:id',
    authMiddleware,
    autorizacaoMiddleware(['adminMaster']),
    validacoes.validarDetalhes,
    auditLogController.obterDetalhesAuditoriaGlobal
);

// Tenant-specific routes
router.get(
    '/',
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['admin']),
    validacoes.validarListagem,
    auditLogController.listarAuditoria
);

// Obter detalhes de um registro específico
router.get(
    '/:id',
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['admin']),
    validacoes.validarDetalhes,
    auditLogController.obterDetalhesAuditoria
);

module.exports = router;