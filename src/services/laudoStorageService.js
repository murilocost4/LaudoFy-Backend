const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');
const logger = require('../utils/logger');

// Usar o mesmo cliente S3 do storageService para consistência
let s3Client;
try {
  // Tentar importar o cliente do storageService existente
  const storageService = require('./storageService');
  if (storageService.s3Client) {
    s3Client = storageService.s3Client;
  } else {
    throw new Error('s3Client não encontrado no storageService');
  }
} catch (error) {
  logger.warn('Criando nova instância S3Client para laudos:', error.message);
  // Fallback: criar nova instância
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// Função para gerar nome único do arquivo de laudo
const generateLaudoFileName = (tenantId, laudoId, type, originalName) => {
  const timestamp = Date.now();
  const randomId = crypto.randomUUID();
  const extension = path.extname(originalName) || '.pdf';
  return `laudos/${tenantId}/${type}/${laudoId}_${timestamp}_${randomId}${extension}`;
};

// Função para fazer upload de laudo para S3
const uploadLaudoToS3 = async (laudoBuffer, laudoId, tenantId, type, originalName) => {
  try {
    const fileName = generateLaudoFileName(tenantId, laudoId, type, originalName);
    
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileName,
      Body: laudoBuffer,
      ContentType: 'application/pdf',
      ServerSideEncryption: 'AES256',
      Metadata: {
        'tenant-id': tenantId.toString(),
        'laudo-id': laudoId.toString(),
        'type': type, // 'original' ou 'assinado'
        'upload-date': new Date().toISOString()
      }
    });
    
    const result = await s3Client.send(uploadCommand);
    
    return {
      success: true,
      key: fileName,
      url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`,
      etag: result.ETag
    };
  } catch (error) {
    console.error('Erro ao fazer upload do laudo para S3:', error);
    throw error;
  }
};

// Função para deletar arquivo de laudo do S3
const deleteLaudoFromS3 = async (fileKey) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileKey
    });
    
    await s3Client.send(command);
    logger.info(`Arquivo de laudo deletado do S3: ${fileKey}`);
    return { success: true };
  } catch (error) {
    logger.error('Erro ao deletar arquivo de laudo do S3:', error);
    return { success: false, error: error.message };
  }
};

// Função para gerar URL assinada para download de laudo
const getSignedUrlForLaudo = async (fileKey, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileKey
    });
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return { success: true, url: signedUrl };
  } catch (error) {
    logger.error('Erro ao gerar URL assinada para laudo:', error);
    return { success: false, error: error.message };
  }
};

// Função para fazer upload usando buffer/stream (para arquivos já processados como assinatura digital)
const uploadLaudoStreamToS3 = async (fileBuffer, fileName, contentType = 'application/pdf') => {
  try {
    // Usar timestamp para nome único se não especificado
    const uniqueFileName = fileName || `laudo_${Date.now()}_${crypto.randomUUID()}.pdf`;
    
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: `laudos/temp/${uniqueFileName}`,
      Body: fileBuffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
      Metadata: {
        'upload-date': new Date().toISOString(),
        'upload-type': 'stream'
      }
    });
    
    const result = await s3Client.send(uploadCommand);
    
    return {
      success: true,
      key: `laudos/temp/${uniqueFileName}`,
      url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/laudos/temp/${uniqueFileName}`,
      etag: result.ETag
    };
  } catch (error) {
    logger.error('Erro ao fazer upload do laudo stream para S3:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  uploadLaudoToS3,
  deleteLaudoFromS3,
  getSignedUrlForLaudo,
  uploadLaudoStreamToS3,
  s3Client
};
