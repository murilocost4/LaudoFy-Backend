const express = require('express');
const authController = require('../controllers/authController');
const { auditLog } = require('../middleware/auditMiddleware');
const {
    limiterLogin,
    limiterRegistro,
    limiterEsqueciSenha,
    limiterRefresh
  } = require('../middleware/rateLimiters');
const authMiddleware = require('../middleware/authMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

const router = express.Router();

router.post('/registrar', 
    authMiddleware,
    tenantMiddleware,
    limiterRegistro,
    authController.validarRegistro, 
    authController.registrar
);

router.post('/login', 
    limiterLogin,
    authController.validarLogin, 
    authController.login
);

router.post('/refresh-token', 
    authMiddleware,
    tenantMiddleware,
    limiterRefresh,
    authController.refreshToken
);

// Novas rotas para recuperação de senha
router.post('/esqueci-senha', 
    limiterEsqueciSenha,
    authController.validarEmail,
    authController.esqueciSenha
);

router.post('/resetar-senha', 
    authController.validarResetSenha,
    authController.resetarSenha
);


router.get('/check', (req, res) => {
    res.json({ status: 'authenticated', user: req.user });
  });

module.exports = router;