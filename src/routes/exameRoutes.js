const express = require('express');
const exameController = require('../controllers/exameController');
const authMiddleware = require('../middleware/authMiddleware');
const { autorizacaoMiddleware, verificarAcessoTenant } = require('../middleware/autorizacaoMiddleware');
const upload = require('../utils/multerConfig'); // CORRIGIDO: Usar a configuração correta
const Exame = require('../models/Exame');
const { auditLog } = require('../middleware/auditMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

const router = express.Router();

// Middleware para tratamento de erros do multer
const handleMulterError = (err, req, res, next) => {
    if (err) {
        console.error('Erro do multer:', err);
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                erro: 'Arquivo muito grande. Tamanho máximo: 10MB',
                codigo: 'FILE_TOO_LARGE'
            });
        }
        
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ 
                erro: 'Apenas um arquivo é permitido por vez',
                codigo: 'TOO_MANY_FILES'
            });
        }
        
        if (err.code === 'LIMIT_FIELD_COUNT') {
            return res.status(400).json({ 
                erro: 'Muitos campos no formulário',
                codigo: 'TOO_MANY_FIELDS'
            });
        }
        
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ 
                erro: 'Campo de arquivo inesperado',
                codigo: 'UNEXPECTED_FIELD'
            });
        }
        
        if (err.message === 'Apenas arquivos PDF são permitidos') {
            return res.status(400).json({ 
                erro: 'Apenas arquivos PDF são permitidos',
                codigo: 'INVALID_FILE_TYPE'
            });
        }
        
        if (err.message && err.message.includes('Campo inesperado')) {
            return res.status(400).json({ 
                erro: err.message,
                codigo: 'UNEXPECTED_FIELD_NAME'
            });
        }
        
        return res.status(400).json({ 
            erro: err.message || 'Erro no upload do arquivo',
            codigo: 'UPLOAD_ERROR'
        });
    }
    next();
};

// Middleware personalizado para debug
const debugUpload = (req, res, next) => {
    console.log('=== DEBUG UPLOAD ===');
    console.log('Content-Type:', req.headers['content-type']);
    console.log('Body keys:', Object.keys(req.body || {}));
    console.log('File:', req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
    } : 'Nenhum arquivo');
    
    // Log detalhado dos campos do body
    if (req.body) {
        console.log('Body fields:');
        Object.entries(req.body).forEach(([key, value]) => {
            console.log(`  ${key}: ${typeof value === 'string' ? value.substring(0, 100) : value}`);
        });
    }
    
    next();
};

// Middleware para verificar FormData antes do multer
const debugFormData = (req, res, next) => {
    console.log('=== DEBUG FORM DATA ===');
    console.log('Headers:', {
        'content-type': req.headers['content-type'],
        'content-length': req.headers['content-length']
    });
    
    // Verificar se é multipart/form-data
    if (!req.headers['content-type'] || !req.headers['content-type'].includes('multipart/form-data')) {
        return res.status(400).json({ 
            erro: 'Content-Type deve ser multipart/form-data',
            codigo: 'INVALID_CONTENT_TYPE'
        });
    }
    
    next();
};

// Rota para criar um exame (apenas técnicos e administradores)
router.post(
    '/',
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['tecnico', 'admin', 'recepcionista']), // Médicos removidos para criação
    debugFormData, // Debug antes do multer
    upload.single('arquivo'), // CORRIGIDO: Usar a configuração do multerConfig
    handleMulterError, // Adicionar tratamento de erro
    debugUpload, // Debug middleware
    exameController.validarExame,
    exameController.criarExame
);

// Rota para listar exames com paginação e filtros
router.get('/', authMiddleware, tenantMiddleware, exameController.listarExames);

// Rota para listar exames para seleção
router.get('/selecao', authMiddleware, tenantMiddleware, exameController.listarExamesParaSelecao);

// Rota para listar exames sem laudo
router.get('/sem-laudo', authMiddleware, tenantMiddleware, exameController.listarExamesSemLaudo);

// Rota para obter um exame por ID (todos os usuários autenticados)
router.get('/:id', authMiddleware, tenantMiddleware, exameController.obterExame);

router.get('/:id/download', authMiddleware, tenantMiddleware, exameController.downloadArquivo);

// Rota para atualizar um exame (técnicos, administradores e recepcionistas)
router.put(
    '/:id',
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['tecnico', 'admin', 'recepcionista']), // Incluindo recepcionista para edição
    debugFormData, // Debug antes do multer
    upload.single('arquivo'), // CORRIGIDO: Usar a configuração do multerConfig
    handleMulterError, // Adicionar tratamento de erro
    debugUpload, // Debug middleware
    exameController.validarExame,
    exameController.atualizarExame
);

// Rota para deletar um exame (apenas administradores)
router.delete(
    '/:id',
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['admin']), // Mantendo apenas admin para exclusão
    exameController.deletarExame
);

// Rota específica para upload (se necessário)
router.post('/upload', 
    authMiddleware,
    tenantMiddleware,
    autorizacaoMiddleware(['tecnico', 'admin', 'recepcionista']),
    debugFormData,
    upload.single('arquivo'),
    handleMulterError,
    debugUpload,
    exameController.uploadExame
);

module.exports = router;