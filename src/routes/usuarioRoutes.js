const express = require('express');
const usuarioController = require('../controllers/usuarioController');
const authMiddleware = require('../middleware/authMiddleware');
const {autorizacaoMiddleware} = require('../middleware/autorizacaoMiddleware');
const { auditLog } = require('../middleware/auditMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Limite de requisições para rotas críticas (proteção contra brute-force e abuso)
const createUpdateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 20,
    message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

// Criar usuário (apenas admin)
router.post(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['admin', 'adminMaster']),
    createUpdateLimiter,
    usuarioController.criarUsuario
);

// Listar todos os usuários (admin)
router.get(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['admin', 'adminMaster']),
    usuarioController.listarUsuarios
);

// Rota para verificar se médico já existe (DEVE vir ANTES da rota /:id)
router.get('/verificar-medico', 
    authMiddleware, 
    autorizacaoMiddleware(['admin', 'adminMaster']), 
    usuarioController.verificarMedicoExistente
);

// Rota para listar médicos (para filtros - acessível por usuários autenticados)
router.get('/medicos', 
    authMiddleware, 
    usuarioController.listarMedicos
);

// Obter um usuário específico (admin)
router.get(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin', 'adminMaster']),
    usuarioController.getUsuario
);

// Atualizar um usuário (admin)
router.put(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin', 'adminMaster']),
    createUpdateLimiter,
    usuarioController.atualizarUsuario
);

module.exports = router;