const express = require('express');
const router = express.Router();
const tipoExameController = require('../controllers/tipoExameController');

// Listar todos os tipos de exame
router.get('/', tipoExameController.listarTiposExame);

// Criar um novo tipo de exame
router.post('/', tipoExameController.criarTipoExame);

// Atualizar um tipo de exame
router.put('/:id', tipoExameController.atualizarTipoExame);

// Deletar um tipo de exame
router.delete('/:id', tipoExameController.deletarTipoExame);

module.exports = router;
