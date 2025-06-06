const express = require('express');
const pacienteController = require('../controllers/pacienteController');
const authMiddleware = require('../middleware/authMiddleware');
const { auditLog } = require('../middleware/auditMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

const router = express.Router();

// Rotas de Pacientes
router.post('/', 
    authMiddleware,
    tenantMiddleware,
    pacienteController.criarPaciente
);
router.get('/', authMiddleware, tenantMiddleware, pacienteController.listarPacientes);
router.get('/:id', authMiddleware, tenantMiddleware, pacienteController.obterPaciente);

router.put(
    '/:id', 
    authMiddleware,
    tenantMiddleware,
    pacienteController.atualizarPaciente
);

router.delete('/:id', authMiddleware, tenantMiddleware, pacienteController.deletarPaciente);

module.exports = router;
