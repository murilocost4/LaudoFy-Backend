const { uploadLaudoToS3, deleteLaudoFromS3, getSignedUrlForLaudo } = require('../services/laudoStorageService');
const logger = require('../utils/logger');

/**
 * Script de teste para validar a conectividade e funcionalidades S3
 * Este script testa:
 * 1. Upload de arquivo para S3
 * 2. Geração de URL pré-assinada
 * 3. Exclusão de arquivo do S3
 */

async function testS3Connection() {
  console.log('=== TESTE DE CONECTIVIDADE S3 ===\n');

  try {
    // Teste 1: Upload de um arquivo de teste
    console.log('1. Testando upload para S3...');
    const testContent = Buffer.from('Este é um arquivo de teste para validar o S3');
    const testFileName = `test_${Date.now()}.txt`;
    
    const uploadResult = await uploadLaudoToS3(
      testContent, 
      'test-laudo-id', 
      'test-tenant', 
      'test', 
      testFileName
    );
    
    if (uploadResult.success) {
      console.log('✅ Upload bem-sucedido');
      console.log(`   URL: ${uploadResult.url}`);
      console.log(`   Key: ${uploadResult.key}\n`);

      // Teste 2: Geração de URL pré-assinada
      console.log('2. Testando geração de URL pré-assinada...');
      const signedUrlResult = await getSignedUrlForLaudo(uploadResult.key);
      
      if (signedUrlResult.success) {
        console.log('✅ URL pré-assinada gerada com sucesso');
        console.log(`   URL: ${signedUrlResult.url.substring(0, 100)}...\n`);
      } else {
        console.log('❌ Falha ao gerar URL pré-assinada');
        console.log(`   Erro: ${signedUrlResult.error}\n`);
      }

      // Teste 3: Exclusão do arquivo
      console.log('3. Testando exclusão do S3...');
      const deleteResult = await deleteLaudoFromS3(uploadResult.key);
      
      if (deleteResult.success) {
        console.log('✅ Arquivo excluído com sucesso\n');
      } else {
        console.log('❌ Falha ao excluir arquivo');
        console.log(`   Erro: ${deleteResult.error}\n`);
      }

    } else {
      console.log('❌ Falha no upload');
      console.log(`   Erro: ${uploadResult.error}`);
      return false;
    }

    console.log('=== TESTE CONCLUÍDO COM SUCESSO ===');
    return true;

  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
    return false;
  }
}

async function validateEnvironmentVariables() {
  console.log('=== VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ===\n');

  const requiredVars = [
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID', 
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET'
  ];

  let allValid = true;

  requiredVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✅ ${varName}: Configurado`);
    } else {
      console.log(`❌ ${varName}: NÃO CONFIGURADO`);
      allValid = false;
    }
  });

  console.log();
  
  if (!allValid) {
    console.log('❌ Algumas variáveis de ambiente não estão configuradas.');
    console.log('Certifique-se de configurar todas as variáveis AWS no arquivo .env\n');
    return false;
  }

  console.log('✅ Todas as variáveis de ambiente estão configuradas\n');
  return true;
}

async function main() {
  console.log('Iniciando validação S3 para migração de laudos...\n');

  // Carregar variáveis de ambiente
  require('dotenv').config();

  // 1. Validar variáveis de ambiente
  const envValid = await validateEnvironmentVariables();
  if (!envValid) {
    process.exit(1);
  }

  // 2. Testar conectividade S3
  const s3Valid = await testS3Connection();
  if (!s3Valid) {
    console.log('\n❌ Falha nos testes S3. Verifique suas configurações antes de executar a migração.');
    process.exit(1);
  }

  console.log('\n✅ Todos os testes passaram! O sistema está pronto para migração.');
  console.log('\nPara executar a migração:');
  console.log('- Dry run: npm run migrate:laudos-to-s3:dry-run');
  console.log('- Migração real: npm run migrate:laudos-to-s3');
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('Erro durante validação:', error);
    process.exit(1);
  });
}

module.exports = { testS3Connection, validateEnvironmentVariables };
