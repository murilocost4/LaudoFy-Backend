const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const certificadoController = require('../controllers/certificadoDigitalController');
const authMiddleware = require('../middleware/authMiddleware');
const { autorizacaoMiddleware } = require('../middleware/autorizacaoMiddleware');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Configuração do multer para certificados
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Verificar extensão do arquivo
    const extensoesPermitidas = ['.pfx', '.p12'];
    const extensao = path.extname(file.originalname).toLowerCase();
    
    if (!extensoesPermitidas.includes(extensao)) {
      return cb(new Error('Tipo de arquivo inválido. Apenas .pfx ou .p12 são aceitos.'), false);
    }
    
    // Verificar MIME type
    const mimeTypesPermitidos = [
      'application/x-pkcs12',
      'application/pkcs12',
      'application/octet-stream'
    ];
    
    if (!mimeTypesPermitidos.includes(file.mimetype)) {
      console.warn(`MIME type não reconhecido: ${file.mimetype}, mas extensão válida: ${extensao}`);
    }
    
    cb(null, true);
  }
});

// Rate limiting para operações sensíveis
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3, // Máximo 3 uploads por 15 minutos
  message: { 
    erro: 'Muitas tentativas de upload. Tente novamente em 15 minutos.' 
  },
  standardHeaders: true,
  legacyHeaders: false
});

const validationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // Máximo 10 validações por 5 minutos
  message: { 
    erro: 'Muitas tentativas de validação. Tente novamente em alguns minutos.' 
  }
});

// Validações
const validarUploadCertificado = [
  body('senha')
    .isLength({ min: 1 })
    .withMessage('Senha é obrigatória')
    .isLength({ max: 100 })
    .withMessage('Senha muito longa')
];

const validarAlteracaoStatus = [
  body('ativo')
    .isBoolean()
    .withMessage('Status deve ser true ou false')
];

const validarSenha = [
  body('senha')
    .isLength({ min: 1 })
    .withMessage('Senha é obrigatória')
];

// Middleware para tratamento de erros do multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        erro: 'Arquivo muito grande. Tamanho máximo: 5MB' 
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        erro: 'Apenas um arquivo é permitido' 
      });
    }
  }
  
  if (err.message.includes('Tipo de arquivo inválido')) {
    return res.status(400).json({ 
      erro: err.message 
    });
  }
  
  next(err);
};

// Aplicar autenticação a todas as rotas
router.use(authMiddleware);

// === ROTAS PARA MÉDICOS ===

// Upload de novo certificado (apenas médicos)
router.post('/upload',
  autorizacaoMiddleware(['medico']),
  uploadLimiter,
  upload.single('certificado'),
  handleMulterError,
  validarUploadCertificado,
  certificadoController.uploadCertificado
);

// Listar meus certificados
router.get('/meus',
  autorizacaoMiddleware(['medico']),
  certificadoController.listarMeusCertificados
);

// Obter detalhes de um certificado específico
router.get('/meus/:id',
  autorizacaoMiddleware(['medico']),
  certificadoController.obterCertificado
);

// Alterar status do certificado (ativar/desativar)
router.patch('/meus/:id/status',
  autorizacaoMiddleware(['medico']),
  validarAlteracaoStatus,
  certificadoController.alterarStatusCertificado
);

// Remover certificado
router.delete('/meus/:id',
  autorizacaoMiddleware(['medico']),
  certificadoController.removerCertificado
);

// Validar senha do certificado
router.post('/meus/:id/validar-senha',
  autorizacaoMiddleware(['medico']),
  validationLimiter,
  validarSenha,
  certificadoController.validarSenhaCertificado
);

// Obter estatísticas dos meus certificados
router.get('/meus/estatisticas/resumo',
  autorizacaoMiddleware(['medico']),
  certificadoController.obterEstatisticasCertificados
);

// === ROTAS ADMINISTRATIVAS ===

// Listar todos os certificados (apenas AdminMaster)
router.get('/admin/todos',
  autorizacaoMiddleware(['adminMaster']),
  certificadoController.listarTodosCertificados
);

// Middleware de tratamento de erros geral para as rotas
router.use((err, req, res, next) => {
  console.error('Erro nas rotas de certificado:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      erro: 'Dados inválidos',
      detalhes: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      erro: 'ID inválido'
    });
  }
  
  res.status(500).json({
    erro: 'Erro interno do servidor',
    detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;
