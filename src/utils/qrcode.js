const QRCode = require('qrcode');

async function generateQR(content) {
  try {
    return await QRCode.toDataURL(content);
  } catch (err) {
    console.error('Erro ao gerar QR Code:', err);
    return null;
  }
}

module.exports = { generateQR };