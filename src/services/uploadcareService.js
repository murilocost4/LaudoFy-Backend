const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

async function uploadPDFToUploadcare(file) {
  try {
    const form = new FormData();
    form.append('UPLOADCARE_PUB_KEY', process.env.UPLOADCARE_PUBLIC_KEY);
    form.append('UPLOADCARE_STORE', '1');

    // Verifica se o arquivo está no formato esperado
    if (!file || !file.buffer) {
      throw new Error('Objeto de arquivo inválido - buffer não encontrado');
    }

    // Adiciona o arquivo ao FormData
    form.append('file', file.buffer, {
      filename: file.originalname || `laudo_${Date.now()}.pdf`,
      contentType: file.mimetype || 'application/pdf'
    });

    const response = await axios.post('https://upload.uploadcare.com/base/', form, {
      headers: {
        ...form.getHeaders(),
        'Content-Length': form.getLengthSync()
      }
    });

    if (!response.data || !response.data.file) {
      throw new Error('Resposta inválida do UploadCare');
    }

    return `https://ucarecdn.com/${response.data.file}/`;
    
  } catch (error) {
    console.error('Erro no upload para UploadCare:', error);
    throw new Error(`Falha no upload: ${error.message}`);
  }
}

module.exports = { uploadPDFToUploadcare };