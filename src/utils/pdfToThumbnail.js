const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

exports.gerarThumbnailPDF = async(pdfPath, thumbnailPath) => {
  try {
    // 1. Ler o PDF
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    // 2. Extrair a primeira página
    const pages = pdfDoc.getPages();
    if (pages.length === 0) throw new Error('PDF não contém páginas');
    
    // 3. Criar uma imagem representativa (simplificado)
    // Nota: Esta é uma abordagem simplificada que não renderiza o conteúdo real do PDF
    const image = await sharp({
      create: {
        width: 800,
        height: 1100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .composite([{
      input: Buffer.from(`<svg width="800" height="1100">
        <rect width="100%" height="100%" fill="#f0f0f0"/>
        <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#333" text-anchor="middle">${path.basename(pdfPath)}</text>
      </svg>`),
      top: 0,
      left: 0
    }])
    .jpeg({ quality: 75 })
    .toFile(thumbnailPath);
    
    return thumbnailPath;
  } catch (err) {
    console.error('Erro ao gerar thumbnail simplificada:', err);
    throw err;
  }
}