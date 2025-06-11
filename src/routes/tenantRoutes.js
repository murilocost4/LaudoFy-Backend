const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');

router.get('/', tenantController.listarTenants);
router.post('/', tenantController.criarTenant);
router.put('/:id', tenantController.atualizarTenant);
router.delete('/:id', tenantController.deletarTenant);

// Route to get a tenant by ID
router.get('/:id', tenantController.obterTenantPorId);

module.exports = router;
