const mongoose = require('mongoose');
const Laudo = require('../models/Laudo');
const { uploadLaudoToS3, deleteLaudoFromS3 } = require('../services/laudoStorageService');
const logger = require('../utils/logger');
const axios = require('axios');

// Configuração do banco de dados
require('dotenv').config();

/**
 * Script para migrar laudos existentes do UploadCare para Amazon S3
 * Este script:
 * 1. Busca todos os laudos que ainda não têm chaves S3
 * 2. Baixa os arquivos do UploadCare
 * 3. Faz upload para S3
 * 4. Atualiza o registro no banco com as novas chaves S3
 * 5. Opcionalmente remove os arquivos do UploadCare (apenas se configurado)
 */

class LaudoMigration {
  constructor() {
    this.processedCount = 0;
    this.errorCount = 0;
    this.skippedCount = 0;
    this.deleteFromUploadCare = process.env.DELETE_FROM_UPLOADCARE === 'true';
  }

  async connectDatabase() {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      logger.info('Conectado ao MongoDB');
    } catch (error) {
      logger.error('Erro ao conectar ao MongoDB:', error);
      throw error;
    }
  }

  async downloadFileFromUploadCare(uploadCareUrl) {
    try {
      const response = await axios.get(uploadCareUrl, {
        responseType: 'arraybuffer',
        timeout: 30000, // 30 segundos timeout
      });
      
      return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/pdf'
      };
    } catch (error) {
      logger.error(`Erro ao baixar arquivo do UploadCare: ${uploadCareUrl}`, error);
      throw error;
    }
  }

  async migrateLaudo(laudo) {
    try {
      // Verificar se já tem chaves S3 (já migrado)
      if (laudo.laudoOriginalKey || laudo.laudoAssinadoKey) {
        logger.info(`Laudo ${laudo._id} já migrado, pulando...`);
        this.skippedCount++;
        return true;
      }

      // Verificar se tem arquivoPath válido
      if (!laudo.arquivoPath || !laudo.arquivoPath.includes('uploadcare') && !laudo.arquivoPath.includes('ucarecdn')) {
        logger.warn(`Laudo ${laudo._id} não tem URL válida do UploadCare: ${laudo.arquivoPath}`);
        this.skippedCount++;
        return true;
      }

      logger.info(`Migrando laudo ${laudo._id}...`);

      // Baixar arquivo do UploadCare
      const fileData = await this.downloadFileFromUploadCare(laudo.arquivoPath);
      
      // Determinar o tipo de laudo baseado no status
      const isAssinado = laudo.status === 'Laudo assinado' || laudo.assinadoDigitalmente;
      const fileName = isAssinado ? 
        `laudo_assinado_${laudo._id}.pdf` : 
        `laudo_original_${laudo._id}.pdf`;

      // Upload para S3
      const s3Result = await uploadLaudoToS3(
        fileData.buffer,
        fileName,
        fileData.contentType
      );

      if (!s3Result.success) {
        throw new Error(`Falha no upload S3: ${s3Result.error}`);
      }

      // Atualizar registro no banco
      const updateData = {
        arquivoPath: s3Result.url, // Manter compatibilidade
      };

      if (isAssinado) {
        updateData.laudoAssinadoKey = s3Result.key;
      } else {
        updateData.laudoOriginalKey = s3Result.key;
      }

      await Laudo.findByIdAndUpdate(laudo._id, updateData);

      logger.info(`Laudo ${laudo._id} migrado com sucesso para S3: ${s3Result.key}`);
      this.processedCount++;

      // Opcional: remover do UploadCare (apenas se configurado)
      if (this.deleteFromUploadCare) {
        try {
          // Aqui você implementaria a remoção do UploadCare se necessário
          // Por segurança, deixamos comentado
          logger.info(`Arquivo ${laudo._id} mantido no UploadCare por segurança`);
        } catch (deleteError) {
          logger.warn(`Erro ao remover do UploadCare (não crítico): ${deleteError.message}`);
        }
      }

      return true;

    } catch (error) {
      logger.error(`Erro ao migrar laudo ${laudo._id}:`, error);
      this.errorCount++;
      return false;
    }
  }

  async migrateAllLaudos() {
    try {
      // Buscar todos os laudos que ainda não foram migrados
      const laudos = await Laudo.find({
        $and: [
          { arquivoPath: { $exists: true, $ne: null } },
          {
            $or: [
              { laudoOriginalKey: { $exists: false } },
              { laudoOriginalKey: null },
              { laudoAssinadoKey: { $exists: false } },
              { laudoAssinadoKey: null }
            ]
          }
        ]
      }).select('_id arquivoPath status assinadoDigitalmente laudoOriginalKey laudoAssinadoKey');

      logger.info(`Encontrados ${laudos.length} laudos para migração`);

      if (laudos.length === 0) {
        logger.info('Nenhum laudo precisa ser migrado');
        return;
      }

      // Processar laudos em lotes para evitar sobrecarga
      const batchSize = 10;
      
      for (let i = 0; i < laudos.length; i += batchSize) {
        const batch = laudos.slice(i, i + batchSize);
        
        logger.info(`Processando lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(laudos.length / batchSize)}`);
        
        const promises = batch.map(laudo => this.migrateLaudo(laudo));
        await Promise.allSettled(promises);
        
        // Pequena pausa entre lotes
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('=== MIGRAÇÃO CONCLUÍDA ===');
      logger.info(`Laudos processados: ${this.processedCount}`);
      logger.info(`Laudos com erro: ${this.errorCount}`);
      logger.info(`Laudos pulados: ${this.skippedCount}`);
      logger.info(`Total analisado: ${laudos.length}`);

    } catch (error) {
      logger.error('Erro durante a migração:', error);
      throw error;
    }
  }

  async run() {
    try {
      await this.connectDatabase();
      await this.migrateAllLaudos();
    } catch (error) {
      logger.error('Erro durante execução da migração:', error);
      process.exit(1);
    } finally {
      await mongoose.connection.close();
      logger.info('Conexão com MongoDB fechada');
    }
  }
}

// Executar migração se chamado diretamente
if (require.main === module) {
  const migration = new LaudoMigration();
  migration.run().then(() => {
    logger.info('Migração finalizada');
    process.exit(0);
  }).catch(error => {
    logger.error('Erro na migração:', error);
    process.exit(1);
  });
}

module.exports = LaudoMigration;
