const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encrypt } = require('./src/utils/crypto');
require('dotenv').config();

async function criarAdminMaster() {
  try {
    // Conectar ao MongoDB
    console.log('🔌 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: 'laudos-medicos'
    });
    console.log('✅ Conectado ao MongoDB');

    // Importar modelo de usuário
    const Usuario = require('./src/models/Usuario');

    // Dados do usuário adminMaster
    const dadosAdmin = {
      nome: 'Murilo Admin Master',
      email: 'murilo@email.com',
      senha: 'senha123',
      role: 'adminMaster',
      isAdminMaster: true,
      ativo: true,
      permissaoFinanceiro: true,
      tenant_id: [], // AdminMaster não precisa de tenant específico
      papeis: [],
      especialidades: []
    };

    // Verificar se já existe um usuário com este email
    console.log('🔍 Verificando se usuário já existe...');
    const usuarioExistente = await Usuario.findOne({ email: dadosAdmin.email });
    
    if (usuarioExistente) {
      console.log('⚠️  Usuário já existe! Removendo usuário existente...');
      await Usuario.deleteOne({ email: dadosAdmin.email });
      console.log('🗑️  Usuário existente removido');
    }

    // Criar novo usuário adminMaster
    console.log('👤 Criando usuário adminMaster...');
    const novoAdmin = new Usuario(dadosAdmin);
    
    // Salvar usuário (a senha será hasheada automaticamente pelo middleware pre-save)
    await novoAdmin.save();
    
    console.log('✅ Usuário adminMaster criado com sucesso!');
    console.log('📋 Dados do usuário:');
    console.log(`   Email: ${dadosAdmin.email}`);
    console.log(`   Senha: ${dadosAdmin.senha}`);
    console.log(`   Role: ${dadosAdmin.role}`);
    console.log(`   Admin Master: ${dadosAdmin.isAdminMaster}`);
    console.log(`   Ativo: ${dadosAdmin.ativo}`);
    console.log(`   ID: ${novoAdmin._id}`);

    // Verificar se a senha foi hasheada corretamente
    const senhaHasheada = novoAdmin.senha.startsWith('$2b$');
    console.log(`   Senha hasheada: ${senhaHasheada ? '✅' : '❌'}`);
    
    // Testar comparação de senha
    const senhaValida = await novoAdmin.compararSenha(dadosAdmin.senha);
    console.log(`   Teste de senha: ${senhaValida ? '✅' : '❌'}`);

    console.log('\n🎉 AdminMaster criado e pronto para uso!');
    console.log('🔗 Você pode fazer login com:');
    console.log(`   Email: ${dadosAdmin.email}`);
    console.log(`   Senha: ${dadosAdmin.senha}`);

  } catch (error) {
    console.error('❌ Erro ao criar adminMaster:', error);
    
    if (error.code === 11000) {
      console.error('   Erro: Email já existe no banco de dados');
    } else if (error.name === 'ValidationError') {
      console.error('   Erro de validação:', error.message);
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

// Executar a função
criarAdminMaster();
