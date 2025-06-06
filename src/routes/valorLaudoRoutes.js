/* valorLaudoRoutes.js */
const express = require('express');
const router = express.Router();
const valorLaudoController = require('../controllers/valorLaudoController');
const authMiddleware = require('../middleware/authMiddleware');

// Listar valores com filtros
router.get('/valores', authMiddleware, valorLaudoController.listarValores);

// Buscar valor específico
router.get('/valores/buscar', authMiddleware, valorLaudoController.buscarValor);

// Criar novo valor
router.post('/valores', authMiddleware, valorLaudoController.criarValor);

// Atualizar valor
router.put('/valores/:id', authMiddleware, valorLaudoController.atualizarValor);

// Excluir valor
router.delete('/valores/:id', authMiddleware, valorLaudoController.excluirValor);

router.post('/valores/bulk', authMiddleware, valorLaudoController.criarValoresEmLote);

module.exports = router;