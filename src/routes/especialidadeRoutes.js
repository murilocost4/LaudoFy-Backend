const express = require('express');
const router = express.Router();
const especialidadeController = require('../controllers/especialidadeController');

router.get('/', especialidadeController.listarEspecialidades);
router.post('/', especialidadeController.criarEspecialidade);
router.put('/:id', especialidadeController.atualizarEspecialidade);
router.delete('/:id', especialidadeController.deletarEspecialidade);
router.get('/:id', especialidadeController.buscarEspecialidade);
router.get('/:id/tipos-exame', especialidadeController.buscarTiposExame);

module.exports = router;
