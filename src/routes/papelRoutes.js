const express = require('express');
const router = express.Router();
const papelController = require('../controllers/papelController');

router.get('/', papelController.listarPapeis);
router.post('/', papelController.criarPapel);
router.put('/:id', papelController.atualizarPapel);
router.delete('/:id', papelController.deletarPapel);

module.exports = router;
