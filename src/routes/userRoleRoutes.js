const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authMiddleware = require('../middleware/authMiddleware');
const userRoleController = require('../controllers/userRoleController');

// Middleware de autenticação aplicado a todas as rotas
router.use(authMiddleware);

// Validações
const validarRole = [
  body('role')
    .isIn(['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'])
    .withMessage('Role inválida')
];

const validarRolePrincipal = [
  body('novaRolePrincipal')
    .isIn(['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'])
    .withMessage('Role principal inválida')
];

// Rotas para gerenciamento de roles - apenas admins e adminMaster
const verificarPermissaoAdmin = authMiddleware.verificarRole(['admin', 'adminMaster']);

// GET /user-roles - Listar todos os usuários com suas roles (com filtro por tenant)
router.get('/', 
  verificarPermissaoAdmin,
  authMiddleware.filtrarPorTenantsAdmin,
  userRoleController.listarUsuariosComRoles
);

// GET /user-roles/:id - Obter roles de um usuário específico
router.get('/:id', 
  verificarPermissaoAdmin,
  userRoleController.obterRolesUsuario
);

// POST /user-roles/:id/add-role - Adicionar role adicional
router.post('/:id/add-role', 
  verificarPermissaoAdmin,
  validarRole,
  userRoleController.adicionarRole
);

// POST /user-roles/:id/remove-role - Remover role adicional
router.post('/:id/remove-role', 
  verificarPermissaoAdmin,
  validarRole,
  userRoleController.removerRole
);

// PUT /user-roles/:id/primary-role - Alterar role principal
router.put('/:id/primary-role', 
  verificarPermissaoAdmin,
  validarRolePrincipal,
  userRoleController.alterarRolePrincipal
);

module.exports = router;
