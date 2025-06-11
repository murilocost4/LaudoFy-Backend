const mongoose = require('mongoose');
require('dotenv').config();

async function zerarTodasTabelas() {
  try {
    // Conectar ao MongoDB
    console.log('🔌 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: 'laudos-medicos'
    });
    console.log('✅ Conectado ao MongoDB');

    // Obter referência ao banco de dados
    const db = mongoose.connection.db;
    
    // Listar todas as coleções
    console.log('📋 Listando todas as coleções...');
    const collections = await db.listCollections().toArray();
    
    if (collections.length === 0) {
      console.log('📭 Nenhuma coleção encontrada no banco de dados');
      return;
    }

    console.log(`📊 Encontradas ${collections.length} coleções:`);
    collections.forEach(collection => {
      console.log(`   - ${collection.name}`);
    });

    console.log('\n🗑️  Iniciando limpeza das coleções...');
    
    // Contadores
    let colechesLimpas = 0;
    let totalDocumentosRemovidos = 0;

    // Limpar cada coleção
    for (const collection of collections) {
      const collectionName = collection.name;
      
      try {
        // Contar documentos antes da limpeza
        const documentosAntes = await db.collection(collectionName).countDocuments();
        
        if (documentosAntes > 0) {
          // Limpar a coleção
          const resultado = await db.collection(collectionName).deleteMany({});
          
          console.log(`   ✅ ${collectionName}: ${resultado.deletedCount} documentos removidos`);
          totalDocumentosRemovidos += resultado.deletedCount;
        } else {
          console.log(`   ✓ ${collectionName}: já estava vazia`);
        }
        
        colechesLimpas++;
      } catch (error) {
        console.error(`   ❌ Erro ao limpar ${collectionName}:`, error.message);
      }
    }

    console.log('\n📊 Resumo da limpeza:');
    console.log(`   Coleções processadas: ${colechesLimpas}/${collections.length}`);
    console.log(`   Total de documentos removidos: ${totalDocumentosRemovidos}`);

    // Verificar se todas as coleções estão vazias
    console.log('\n🔍 Verificando se as coleções estão vazias...');
    let todasVazias = true;
    
    for (const collection of collections) {
      const count = await db.collection(collection.name).countDocuments();
      if (count > 0) {
        console.log(`   ⚠️  ${collection.name}: ainda tem ${count} documentos`);
        todasVazias = false;
      } else {
        console.log(`   ✅ ${collection.name}: vazia`);
      }
    }

    if (todasVazias) {
      console.log('\n🎉 Todas as coleções foram limpas com sucesso!');
      console.log('🔄 O banco de dados está pronto para uso');
    } else {
      console.log('\n⚠️  Algumas coleções ainda contêm dados');
    }

    // Opcional: Remover as coleções completamente (descomente se quiser)
    // console.log('\n🗑️  Removendo coleções vazias...');
    // for (const collection of collections) {
    //   try {
    //     await db.collection(collection.name).drop();
    //     console.log(`   ✅ Coleção ${collection.name} removida`);
    //   } catch (error) {
    //     console.log(`   ⚠️  ${collection.name}: ${error.message}`);
    //   }
    // }

  } catch (error) {
    console.error('❌ Erro ao limpar banco de dados:', error);
    
    if (error.code === 'ENOTFOUND') {
      console.error('   Erro: Não foi possível conectar ao MongoDB. Verifique a URL de conexão.');
    } else if (error.name === 'MongoNetworkError') {
      console.error('   Erro: Problema de rede ao conectar ao MongoDB.');
    } else {
      console.error('   Erro desconhecido:', error.message);
    }
  } finally {
    // Fechar conexão
    await mongoose.connection.close();
    console.log('🔌 Conexão com MongoDB fechada');
    process.exit(0);
  }
}

// Adicionar confirmação antes de executar
console.log('⚠️  ATENÇÃO: Este script irá REMOVER TODOS OS DADOS do banco de dados!');
console.log('📋 Banco: laudos-medicos');
console.log('🕒 Aguardando 3 segundos para confirmação...');

setTimeout(() => {
  console.log('🚀 Iniciando limpeza do banco de dados...\n');
  zerarTodasTabelas();
}, 3000);
