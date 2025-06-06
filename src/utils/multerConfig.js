const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(), // Armazena o arquivo na memória como Buffer
  limits: {
    fileSize: 10 * 1024 * 1024, // Aumentar para 10MB
    files: 1, // Permitir apenas 1 arquivo
    fields: 20, // Aumentar limite de campos não-arquivo
    fieldSize: 100 * 1024, // 100KB por campo
    fieldNameSize: 100, // 100 chars para nome do campo
    parts: 25 // Total de partes (fields + files)
  },
  fileFilter: (req, file, cb) => {
    console.log('=== MULTER FILE FILTER ===');
    console.log('Field name:', file.fieldname);
    console.log('Original name:', file.originalname);
    console.log('Mimetype:', file.mimetype);
    
    // Verificar se o campo é 'arquivo'
    if (file.fieldname !== 'arquivo') {
      console.error(`Campo inesperado: ${file.fieldname}. Esperado: 'arquivo'`);
      return cb(new Error(`Campo inesperado: ${file.fieldname}. Use 'arquivo' como nome do campo.`), false);
    }
    
    // Verificar se é PDF
    if (file.mimetype === 'application/pdf') {
      console.log('Arquivo PDF aceito');
      cb(null, true);
    } else {
      console.error(`Tipo de arquivo não permitido: ${file.mimetype}`);
      cb(new Error('Apenas arquivos PDF são permitidos'), false);
    }
  }
});

module.exports = upload;
