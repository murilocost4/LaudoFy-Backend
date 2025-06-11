require('dotenv').config();
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const Usuario = require('../models/Usuario');
const crypto = require('crypto')
const axios = require('axios')

// Configuração robusta com verificação de ambiente
const initSendGrid = () => {
  if (!process.env.SENDGRID_API_KEY) {
    logger.error('Variável SENDGRID_API_KEY não encontrada');
    throw new Error('Configuração de e-mail incompleta');
  }

  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    logger.info('SendGrid configurado com sucesso');
  } catch (error) {
    logger.error('Falha na configuração do SendGrid', error);
    throw new Error('Falha na inicialização do serviço de e-mail');
  }
};

// Inicialização imediata
initSendGrid();

const sendMedicalReport = async (recipientEmail, patientName, reportId, fileUrl, publicAccessCode) => {
  const startTime = Date.now();

  try {
    // Validações rigorosas
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      throw new Error('Formato de e-mail do destinatário inválido');
    }

    if (!fileUrl || !fileUrl.includes('ucarecdn.com')) {
      throw new Error('URL do arquivo no UploadCare inválida');
    }

    // Baixar o arquivo do UploadCare
    const response = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 10000 // 10 segundos timeout
    });

    const fileContent = response.data;

    // Verificar se é um PDF válido
    if (!fileContent.slice(0, 4).equals(Buffer.from('%PDF'))) {
      throw new Error('O arquivo não é um PDF válido');
    }

    // Construção da mensagem com link público e código de acesso
    const publicLink = `https://laudo-fy-frontend.vercel.app/publico/${reportId}`;
    const msg = {
      to: recipientEmail,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME
      },
      subject: `Laudo Médico #${reportId.substring(0, 8)}`,
      text: `Prezado(a) ${patientName},\n\nSegue em anexo seu laudo médico.\n\nNúmero do Laudo: ${reportId}\n\nAcesso Público: ${publicLink}\nCódigo de Acesso: ${publicAccessCode}`,
      html: `<div style="font-family: Arial, sans-serif;">
              <p>Prezado(a) ${patientName},</p>
              <p>Segue em anexo seu laudo médico.</p>
              
              <div style="background-color: #f8f9fa; border-left: 4px solid #3498db; padding: 12px; margin: 16px 0;">
                <h3 style="margin-top: 0; color: #2c3e50;">Acesso Público</h3>
                <p>Você também pode acessar seu laudo através do link abaixo:</p>
                <p>
                  <a href="${publicLink}" style="color: #3498db; text-decoration: none;">
                    ${publicLink}
                  </a>
                </p>
                <p><strong>Código de Acesso:</strong> ${publicAccessCode}</p>
                <p style="font-size: 0.9em; color: #7f8c8d;">
                  <i>Obs: Será necessário informar o código de acesso para visualizar o laudo.</i>
                </p>
              </div>
              
              <p><strong>Número do Laudo:</strong> ${reportId}</p>
            </div>`,
      attachments: [{
        content: Buffer.from(fileContent).toString('base64'),
        filename: `laudo_${reportId.substring(0, 8)}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }],
      mailSettings: {
        sandboxMode: {
          enable: process.env.NODE_ENV === 'test'
        }
      }
    };

    // Envio com tratamento de timeout
    const sendPromise = sgMail.send(msg);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: Serviço de e-mail não respondeu')), 15000)
    );

    const responseSend = await Promise.race([sendPromise, timeoutPromise]);
    
    logger.info(`E-mail enviado em ${Date.now() - startTime}ms`, {
      messageId: responseSend[0]?.headers?.['x-message-id'],
      recipient: recipientEmail
    });

    return { 
      success: true,
      messageId: responseSend[0]?.headers?.['x-message-id']
    };

  } catch (error) {
    logger.error(`Falha no envio após ${Date.now() - startTime}ms`, {
      error: error.message,
      stack: error.stack,
      recipient: recipientEmail,
      reportId
    });

    throw new Error(`Falha no envio: ${error.message}`);
  }
};

const sendPasswordResetEmail = async (email) => {
  const startTime = Date.now();

  try {
    // Validação do email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Formato de e-mail inválido');
    }

    // Verifica se o usuário existe
    const usuario = await Usuario.findOne({ email });
    if (!usuario) {
      // Por segurança, não revelamos se o email existe
      logger.info(`Solicitação de recuperação para email não cadastrado: ${email}`);
      return { success: true }; // Retorna sucesso mesmo se o email não existir
    }

    // Gera token seguro
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpira = Date.now() + 3600000; // 1 hora

    // Atualiza usuário
    usuario.resetSenhaToken = resetToken;
    usuario.resetSenhaExpira = resetTokenExpira;
    await usuario.save();

    // Prepara a URL de reset
    const resetUrl = `${process.env.FRONTEND_URL}/resetar-senha?token=${resetToken}`;

    // Template de email profissional
    const msg = {
      to: email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: process.env.SENDGRID_FROM_NAME || 'Sistema de Recuperação de Senha'
      },
      subject: 'Redefinição de Senha',
      text: `Você solicitou a redefinição de senha. Use este link para redefinir sua senha: ${resetUrl}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Redefinição de Senha</h2>
          <p>Olá,</p>
          <p>Você solicitou a redefinição de senha para sua conta. Clique no botão abaixo para continuar:</p>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${resetUrl}" 
               style="background-color: #3498db; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 4px; font-weight: bold;">
              Redefinir Senha
            </a>
          </div>
          
          <p>Se você não solicitou esta redefinição, por favor ignore este e-mail.</p>
          <p>Este link expirará em 1 hora.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          
          <p style="font-size: 12px; color: #7f8c8d;">
            Se o botão não funcionar, copie e cole este link no seu navegador:<br>
            ${resetUrl}
          </p>
        </div>
      `,
      mailSettings: {
        sandboxMode: {
          enable: process.env.NODE_ENV === 'test'
        }
      }
    };

    // Envio com timeout
    const sendPromise = sgMail.send(msg);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: Serviço de e-mail não respondeu')), 15000)
    );

    const response = await Promise.race([sendPromise, timeoutPromise]);
    
    logger.info(`E-mail de recuperação enviado em ${Date.now() - startTime}ms`, {
      messageId: response[0]?.headers?.['x-message-id'],
      recipient: email,
      userId: usuario._id
    });

    return { 
      success: true,
      messageId: response[0]?.headers?.['x-message-id']
    };

  } catch (error) {
    logger.error(`Falha no envio de recuperação após ${Date.now() - startTime}ms`, {
      error: error.message,
      stack: error.stack,
      recipient: email
    });
    console.log(error)

    throw new Error(`Falha no envio do e-mail de recuperação: ${error.message}`);
  }
};

module.exports = { sendMedicalReport, sendPasswordResetEmail };