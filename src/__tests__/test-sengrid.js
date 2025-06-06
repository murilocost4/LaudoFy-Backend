// test-sendgrid.js
require('dotenv').config(); // Carrega variáveis do .env
const sgMail = require('@sendgrid/mail');

// Verifica se a chave começa com SG.
if (!process.env.SENDGRID_API_KEY?.startsWith('SG.')) {
  console.error('❌ A chave de API não está no formato correto!');
  console.error('A chave deve começar com "SG."');
  process.exit(1);
}

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function testSend() {
  try {
    console.log('🔑 Chave de API:', process.env.SENDGRID_API_KEY?.substring(0, 6) + '...');
    
    const msg = {
      to: 'murilocoimbracosta@gmail.com', // Substitua por um e-mail real
      from: process.env.SENDGRID_FROM_EMAIL || 'costalaudos@gmail.com',
      subject: 'Teste SendGrid - Laudos Costa',
      text: 'Este é um teste de conexão com o SendGrid',
      html: '<strong>Este é um teste de conexão com o SendGrid</strong>'
    };
    
    console.log('📤 Enviando e-mail de teste...');
    const response = await sgMail.send(msg);
    console.log('✅ E-mail enviado com sucesso!');
    console.log('Resposta:', response[0].headers);
  } catch (error) {
    console.error('❌ Erro no teste:');
    console.error('Mensagem:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.statusCode);
      console.error('Corpo:', error.response.body);
    }
    
    process.exit(1);
  }
}

testSend();