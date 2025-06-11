const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
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

// Storage personalizado para S3 v3
const s3Storage = {
  _handleFile: async (req, file, cb) => {
    try {
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
      
      // Coletar dados do arquivo
      const chunks = [];
      file.stream.on('data', (chunk) => chunks.push(chunk));
      file.stream.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          
          const uploadCommand = new PutObjectCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: fileName,
            Body: buffer,
            ContentType: file.mimetype,
            ServerSideEncryption: 'AES256',
            Metadata: {
              'tenant-id': tenantId.toString(),
              'uploaded-by': req.usuarioId || req.user?.id || 'system',
              'original-name': file.originalname,
              'upload-date': new Date().toISOString()
            }
          });
          
          const result = await s3Client.send(uploadCommand);
          
          // Gerar URL do arquivo
          const fileUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
          
          cb(null, {
            bucket: process.env.AWS_S3_BUCKET,
            key: fileName,
            location: fileUrl,
            etag: result.ETag,
            size: buffer.length
          });
        } catch (error) {
          cb(error);
        }
      });
      
      file.stream.on('error', cb);
    } catch (error) {
      cb(error);
    }
  },
  
  _removeFile: async (req, file, cb) => {
    try {
      if (file.key) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: file.key
        });
        
        await s3Client.send(deleteCommand);
      }
      cb(null);
    } catch (error) {
      cb(error);
    }
  }
};

// Configurar multer para S3 v3
const upload = multer({
  storage: s3Storage,
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
