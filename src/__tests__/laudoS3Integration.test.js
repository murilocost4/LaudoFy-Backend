const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../server');
const Laudo = require('../models/Laudo');
const { 
  uploadLaudoToS3, 
  deleteLaudoFromS3, 
  getSignedUrlForLaudo 
} = require('../services/laudoStorageService');

describe('Laudo S3 Integration Tests', () => {
  let authToken;
  let laudoId;
  let testS3Key;

  beforeAll(async () => {
    // Setup test database connection if needed
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    }
  });

  afterAll(async () => {
    // Clean up test data
    if (testS3Key) {
      await deleteLaudoFromS3(testS3Key);
    }
    
    if (laudoId) {
      await Laudo.findByIdAndDelete(laudoId);
    }

    await mongoose.connection.close();
  });

  describe('S3 Storage Service', () => {
    test('should upload file to S3', async () => {
      const testContent = Buffer.from('Test PDF content for S3 upload');
      const fileName = `test_laudo_${Date.now()}.pdf`;
      
      const result = await uploadLaudoToS3(testContent, fileName, 'application/pdf');
      
      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.key).toBeDefined();
      
      testS3Key = result.key;
    });

    test('should generate signed URL for S3 file', async () => {
      if (!testS3Key) {
        throw new Error('No test S3 key available from previous test');
      }

      const result = await getSignedUrlForLaudo(testS3Key);
      
      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.url).toContain('amazonaws.com');
    });

    test('should delete file from S3', async () => {
      if (!testS3Key) {
        throw new Error('No test S3 key available from previous test');
      }

      const result = await deleteLaudoFromS3(testS3Key);
      
      expect(result.success).toBe(true);
      testS3Key = null; // Mark as deleted
    });
  });

  describe('Laudo Controller S3 Integration', () => {
    beforeEach(async () => {
      // Mock authentication - adjust based on your auth system
      authToken = 'mock-jwt-token'; // Replace with actual test token generation
    });

    test('should download laudo with S3 signed URL', async () => {
      // Create a test laudo with S3 key
      const testLaudo = new Laudo({
        exame: new mongoose.Types.ObjectId(),
        medicoResponsavelId: new mongoose.Types.ObjectId(),
        conclusao: 'Test conclusão',
        status: 'Laudo assinado',
        laudoAssinadoKey: 'test-s3-key',
        arquivoPath: 'https://test-bucket.s3.amazonaws.com/test-key',
        tenant_id: 'test-tenant'
      });

      await testLaudo.save();
      laudoId = testLaudo._id;

      // Mock the S3 signed URL service
      jest.spyOn(require('../services/laudoStorageService'), 'getSignedUrlForLaudo')
          .mockResolvedValue({
            success: true,
            url: 'https://test-bucket.s3.amazonaws.com/test-key?signed=true'
          });

      const response = await request(app)
        .get(`/api/laudos/${laudoId}/download/assinado`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('url');
      expect(response.body.url).toContain('signed=true');
    });

    test('should fallback to UploadCare URL when S3 fails', async () => {
      // Create a test laudo without S3 key but with UploadCare URL
      const testLaudo = new Laudo({
        exame: new mongoose.Types.ObjectId(),
        medicoResponsavelId: new mongoose.Types.ObjectId(),
        conclusao: 'Test conclusão',
        status: 'Laudo assinado',
        arquivoPath: 'https://ucarecdn.com/test-file-id/',
        tenant_id: 'test-tenant'
      });

      await testLaudo.save();
      laudoId = testLaudo._id;

      const response = await request(app)
        .get(`/api/laudos/${laudoId}/download/assinado`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('url');
      expect(response.body.url).toContain('ucarecdn.com');
    });
  });

  describe('Automatic Deletion on Signature', () => {
    test('should delete original laudo after signature', async () => {
      // Create a test laudo with original S3 key
      const testLaudo = new Laudo({
        exame: new mongoose.Types.ObjectId(),
        medicoResponsavelId: new mongoose.Types.ObjectId(),
        conclusao: 'Test conclusão',
        status: 'Laudo pronto para assinatura',
        laudoOriginalKey: 'test-original-key',
        arquivoPath: 'https://test-bucket.s3.amazonaws.com/test-original-key',
        tenant_id: 'test-tenant'
      });

      await testLaudo.save();
      laudoId = testLaudo._id;

      // Mock the deletion service
      const deleteSpy = jest.spyOn(require('../services/laudoStorageService'), 'deleteLaudoFromS3')
                           .mockResolvedValue({ success: true });

      // Mock the signature process
      jest.spyOn(require('../controllers/laudoController'), 'gerarPdfLaudoAssinado')
          .mockResolvedValue({
            success: true,
            fileUrl: 'https://test-bucket.s3.amazonaws.com/test-signed-key',
            s3Key: 'test-signed-key',
            assinadoCom: 'certificado_digital',
            certificadoId: 'test-cert-id'
          });

      const response = await request(app)
        .post(`/api/laudos/${laudoId}/assinar-automaticamente`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify that the deletion was called
      expect(deleteSpy).toHaveBeenCalledWith('test-original-key');

      // Verify that the laudo was updated
      const updatedLaudo = await Laudo.findById(laudoId);
      expect(updatedLaudo.laudoOriginalKey).toBeNull();
      expect(updatedLaudo.laudoAssinadoKey).toBe('test-signed-key');
      expect(updatedLaudo.status).toBe('Laudo assinado');
    });
  });
});

// Mock implementation for testing
jest.mock('../middleware/authMiddleware', () => {
  return (req, res, next) => {
    req.usuario = {
      id: new mongoose.Types.ObjectId(),
      nome: 'Test User',
      tenant_id: 'test-tenant'
    };
    next();
  };
});

jest.mock('../middleware/tenantMiddleware', () => {
  return (req, res, next) => {
    req.tenant_id = 'test-tenant';
    next();
  };
});

// Environment setup for tests
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'test-bucket';
