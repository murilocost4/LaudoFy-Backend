const axios = require('axios');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { fromBuffer } = require('pdf2pic');

async function gerarThumbnailPDFRemoto(pdfUrl, thumbnailPath) {
    try {
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const pdfBuffer = Buffer.from(response.data);

        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const [firstPage] = await pdfDoc.copyPages(pdfDoc, [0]);
        const newDoc = await PDFDocument.create();
        newDoc.addPage(firstPage);
        const singlePagePDF = await newDoc.save();

        const convert = fromBuffer(singlePagePDF, {
            density: 150,
            format: 'jpg',
            width: 600,
            height: 800,
            quality: 90
        });

        await convert(1, {
            savePath: thumbnailPath
        });

    } catch (err) {
        throw new Error(`Erro ao gerar thumbnail: ${err.message}`);
    }
}

module.exports = { gerarThumbnailPDFRemoto };
