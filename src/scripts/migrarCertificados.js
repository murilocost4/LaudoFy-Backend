/**
 * Script de migração para adicionar o campo senhaHash aos certificados existentes
 * 
 * Este script deve ser executado uma vez para migrar os certificados existentes
 * para o novo formato que separa a senha original (para assinatura) do hash (para validação)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('../utils/crypto');

// Conectar ao MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: 'laudos-medicos',
      serverSelectionTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      w: 'majority'
    });
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
    process.exit(1);
  }
};

// Schema temporário para acessar certificados existentes
const CertificadoSchema = new mongoose.Schema({
  medicoId: mongoose.Schema.Types.ObjectId,
  senhaCertificado: {
    type: String,
    get: function(v) {
      if (!v) return v;
      try {
        return decrypt(v);
      } catch (error) {
        console.error('Erro ao descriptografar senha:', error);
        return null;
      }
    }
  },
  senhaHash: {
    type: String
  }
}, { 
  collection: 'certificadodigitals',
  toObject: { getters: true },
  toJSON: { getters: true }
});

const CertificadoTemp = mongoose.model('CertificadoTemp', CertificadoSchema);

const migrarCertificados = async () => {
  try {
    console.log('🔄 Iniciando migração de certificados...');
    
    // Buscar todos os certificados que não têm senhaHash
    const certificados = await CertificadoTemp.find({
      $or: [
        { senhaHash: { $exists: false } },
        { senhaHash: null },
        { senhaHash: '' }
      ]
    });

    if (certificados.length === 0) {
      console.log('✅ Nenhum certificado precisa ser migrado');
      return;
    }

    console.log(`📋 Encontrados ${certificados.length} certificados para migrar`);

    let migrados = 0;
    let erros = 0;

    for (const certificado of certificados) {
      try {
        // A senha descriptografada
        const senhaOriginal = certificado.senhaCertificado;
        
        if (!senhaOriginal) {
          console.warn(`⚠️  Certificado ${certificado._id} não tem senha válida, pulando...`);
          continue;
        }

        // Criar hash bcrypt da senha original
        const senhaHash = await bcrypt.hash(senhaOriginal, 10);
        
        await CertificadoTemp.updateOne(
          { _id: certificado._id },
          { 
            $set: { 
              senhaHash: senhaHash // Hash bcrypt
            }
          }
        );

        migrados++;
        console.log(`✅ Migrado certificado ${certificado._id}`);
        
      } catch (error) {
        erros++;
        console.error(`❌ Erro ao migrar certificado ${certificado._id}:`, error.message);
      }
    }

    console.log('\n📊 Resultado da migração:');
    console.log(`✅ Certificados migrados com sucesso: ${migrados}`);
    console.log(`❌ Erros durante a migração: ${erros}`);
    
    if (erros === 0) {
      console.log('\n🎉 Migração concluída com sucesso!');
      console.log('\n⚠️  IMPORTANTE: Os certificados existentes precisarão ser re-cadastrados');
      console.log('   pelos médicos para que a assinatura automática funcione corretamente.');
      console.log('   Eles continuarão funcionando para validação, mas não para assinatura automática.');
    } else {
      console.log('\n⚠️  Migração concluída com alguns erros. Verifique os logs acima.');
    }

  } catch (error) {
    console.error('❌ Erro geral durante a migração:', error);
    throw error;
  }
};

// Executar migração
const executarMigracao = async () => {
  try {
    await connectDB();
    await migrarCertificados();
  } catch (error) {
    console.error('❌ Falha na migração:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
};

// Verificar se está sendo executado diretamente
if (require.main === module) {
  // Carregar variáveis de ambiente
  require('dotenv').config();
  
  console.log('🚀 Iniciando script de migração de certificados...');
  executarMigracao();
}

module.exports = { migrarCertificados };
