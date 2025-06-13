const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const tenantAdminController = require('../controllers/tenantAdminController');

// Middleware de autenticação aplicado a todas as rotas
router.use(authMiddleware);

// Validações
const validarTenantId = [
  body('tenantId')
    .isMongoId()
    .withMessage('Tenant ID inválido')
];

// Apenas AdminMaster pode gerenciar permissões de admin por tenant
const verificarAdminMaster = authMiddleware.verificarRoleEspecifica('adminMaster');

// GET /tenant-admin/users/:userId/tenants - Listar tenants onde o usuário pode ser admin
router.get('/users/:userId/tenants', 
  tenantAdminController.listarTenantsDisponiveis
);

// POST /tenant-admin/users/:userId/add-admin - Adicionar usuário como admin de um tenant
router.post('/users/:userId/add-admin', 
  verificarAdminMaster,
  validarTenantId,
  tenantAdminController.adicionarAdminTenant
);

// POST /tenant-admin/users/:userId/remove-admin - Remover usuário como admin de um tenant
router.post('/users/:userId/remove-admin', 
  verificarAdminMaster,
  validarTenantId,
  tenantAdminController.removerAdminTenant
);

// GET /tenant-admin/tenants/:tenantId/admins - Listar admins de um tenant específico
router.get('/tenants/:tenantId/admins', 
  tenantAdminController.listarAdminsPorTenant
);

// GET /tenant-admin/statistics - Estatísticas de permissões (apenas AdminMaster)
router.get('/statistics', 
  verificarAdminMaster,
  tenantAdminController.getEstatisticasPermissoes
);

module.exports = router;
