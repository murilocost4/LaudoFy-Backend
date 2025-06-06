const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

module.exports.gerarPDFLaudo = async (laudo) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Cabeçalho
      doc.fillColor('#333333')
        .fontSize(20)
        .text('LAUDO MÉDICO', { align: 'center' })
        .moveDown(0.5);

      // Dados do Paciente
      doc.fontSize(14).text('DADOS DO PACIENTE:', { underline: true });
      doc.fontSize(12)
        .text(`Nome: ${laudo.exame.paciente.nome}`)
        .text(`CPF: ${laudo.exame.paciente.cpf}`)
        .text(`Data Nascimento: ${new Date(laudo.exame.paciente.dataNascimento).toLocaleDateString()}`)
        .moveDown();

      // Dados do Exame
      doc.fontSize(14).text('DADOS DO EXAME:', { underline: true });
      doc.fontSize(12)
        .text(`Tipo: ${laudo.exame.tipo}`)
        .text(`Data: ${new Date(laudo.exame.dataExame).toLocaleDateString()}`)
        .moveDown();

      // Conclusão
      doc.fontSize(14).text('CONCLUSÃO:', { underline: true });
      doc.fontSize(12).text(laudo.conclusao);
      doc.moveDown();

      // Rodapé
      doc.fontSize(10)
        .text(`Laudo versão ${laudo.versao}`, { align: 'right' })
        .text(`Gerado em: ${new Date().toLocaleString()}`, { align: 'right' })
        .text(`Médico responsável: ${laudo.medicoResponsavel}`, { align: 'right' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};