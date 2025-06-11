/* valorLaudoRoutes.js */
const express = require('express');
const router = express.Router();
const valorLaudoController = require('../controllers/valorLaudoController');
const authMiddleware = require('../middleware/authMiddleware');
const { verificarPermissaoFinanceiro } = require('../middleware/financeiroMiddleware');

// Listar valores com filtros
router.get('/valores', authMiddleware, verificarPermissaoFinanceiro, valorLaudoController.listarValores);

// Buscar valor específico
router.get('/valores/buscar', authMiddleware, verificarPermissaoFinanceiro, valorLaudoController.buscarValor);

// Criar novo valor
router.post('/valores', authMiddleware, verificarPermissaoFinanceiro, valorLaudoController.criarValor);

// Atualizar valor
router.put('/valores/:id', authMiddleware, verificarPermissaoFinanceiro, valorLaudoController.atualizarValor);

// Excluir valor
router.delete('/valores/:id', authMiddleware, verificarPermissaoFinanceiro, valorLaudoController.excluirValor);

router.post('/valores/bulk', authMiddleware, valorLaudoController.criarValoresEmLote);

module.exports = router;