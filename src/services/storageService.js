const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const multer = require('multer');
const multerS3 = require('multer-s3');
const crypto = require('crypto');
const path = require('path');

// Configurar AWS SDK v3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Função para gerar nome único do arquivo
const generateFileName = (tenantId, type, originalName) => {
  const timestamp = Date.now();
  const randomId = crypto.randomUUID();
  const extension = path.extname(originalName);
  return `${type}/${tenantId}/${timestamp}_${randomId}${extension}`;
};

// Configurar multer para S3 v3
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET,
    serverSideEncryption: 'AES256',
    key: function (req, file, cb) {
      // Corrigir acesso ao tenant_id
      let tenantId = req.tenant_id || req.user?.tenant_id || 'default';
      
      // Se tenant_id for array, pegar o primeiro
      if (Array.isArray(tenantId)) {
        if (tenantId.length > 0) {
          if (typeof tenantId[0] === 'object' && tenantId[0]._id) {
            tenantId = tenantId[0]._id;
          } else {
            tenantId = tenantId[0];
          }
        } else {
          tenantId = 'default';
        }
      }
      
      const type = 'exames';
      const fileName = generateFileName(tenantId, type, file.originalname);
      cb(null, fileName);
    },
    metadata: function (req, file, cb) {
      let tenantId = req.tenant_id || req.user?.tenant_id || 'default';
      
      if (Array.isArray(tenantId)) {
        if (tenantId.length > 0) {
          if (typeof tenantId[0] === 'object' && tenantId[0]._id) {
            tenantId = tenantId[0]._id;
          } else {
            tenantId = tenantId[0];
          }
        } else {
          tenantId = 'default';
        }
      }
      
      cb(null, {
        'tenant-id': tenantId,
        'uploaded-by': req.usuarioId || req.user?.id || 'system',
        'original-name': file.originalname,
        'upload-date': new Date().toISOString()
      });
    }
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024 // 100MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido. Apenas PDF, JPG e PNG são aceitos.'), false);
    }
  }
});

// Função para deletar arquivo do S3 v3
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

const deleteFile = async (fileKey) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileKey
    });
    
    await s3Client.send(command);
    console.log(`Arquivo deletado do S3: ${fileKey}`);
    return true;
  } catch (error) {
    console.error('Erro ao deletar arquivo do S3:', error);
    return false;
  }
};

// Função para gerar URL assinada (temporária) v3
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const getSignedUrlForFile = async (fileKey, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileKey
    });
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('Erro ao gerar URL assinada:', error);
    throw error;
  }
};

module.exports = {
  upload,
  deleteFile,
  getSignedUrl: getSignedUrlForFile,
  s3Client
};