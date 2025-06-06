const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const Laudo = require('../models/Laudo');
const Exame = require('../models/Exame');
const { sendMedicalReport } = require('../services/emailService');
const logger = require('../utils/logger');
const QRCode = require('qrcode');
const AuditLog = require('../models/AuditModel');
const Usuario = require('../models/Usuario');
const { uploadPDFToUploadcare } = require('../services/uploadcareService');
const imageSize = require('image-size');
const { plainAddPlaceholder } = require('@signpdf/placeholder-plain');
const { encrypt, decrypt } = require('../utils/crypto');
const { validationResult } = require('express-validator');
const { format } = require('date-fns');

// Configurações de diretórios
const LAUDOS_DIR = path.join(__dirname, '../../laudos');
const LAUDOS_ASSINADOS_DIR = path.join(LAUDOS_DIR, 'assinado');
const LOGO_PATH = path.join(__dirname, '../assets/logo-png.png');
const LOGO_LAUDOFY = path.join(__dirname, '../assets/laudofy-logo.png');
const ASSINATURA_PATH = path.join(__dirname, '../assets/assinatura_sem_fundo.png');
const CERTIFICATE_PATH = path.join(__dirname, '../config/certificado.pfx');

// Criar diretórios se não existirem
try {
  [LAUDOS_DIR, LAUDOS_ASSINADOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (err) {
  console.error('Could not create directories:', err);
  process.exit(1);
}

// Função auxiliar para calcular idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const m = hoje.getMonth() - nascimento.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }
  return idade;
}

// Define default styles if none are provided
const defaultStyles = {
  colors: {
    primary: '#007bff',
    light: '#ffffff',
    dark: '#343a40',
    gray: '#6c757d',
    text: '#212529'
  },
  margins: {
    left: 30,
    right: 30,
    headerRight: 30,
    top: 30
  },
  fonts: {
    small: 10,
    normal: 12,
    label: 10,
    title: 16,
    section: 14
  },
  spacing: {
    section: 20,
    paragraph: 10,
    line: 5
  }
};

// Função base para gerar o conteúdo do PDF do laudo - CORRIGIDA
async function gerarConteudoPdfLaudo(doc, laudo, exame, usuarioMedico, medicoNome, conclusao, publicLink, styles) {
  // Ensure styles is defined with required properties
  styles = {
    ...defaultStyles,
    ...(styles || {})
  };

  // Cabeçalho
  const addHeader = () => {
    doc.fillColor(styles.colors.primary)
      .rect(0, 0, doc.page.width, 80)
      .fill();

    if (LOGO_PATH && fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, styles.margins.left, 15, { height: 38 });
    } else {
      doc.fillColor(styles.colors.light)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('LOGO', styles.margins.left, 30);
    }

    const rightTextX = doc.page.width - styles.margins.headerRight;
    doc.fillColor(styles.colors.light)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.small)
      .text(`LAUDO #${laudo._id.toString().substring(0, 8)}`,
        rightTextX, 20, { align: 'right', width: 100 })
      .font('Helvetica')
      .text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`,
        rightTextX, 40, { align: 'right', width: 100 });
  };

  addHeader();

  // Logo de fundo
  if (LOGO_LAUDOFY && fs.existsSync(LOGO_LAUDOFY)) {
    doc.opacity(0.04);
    doc.image(LOGO_LAUDOFY, doc.page.width / 2 - 200, doc.page.height / 2 - 200, { width: 400 });
    doc.opacity(1);
  }

  // Título
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.title)
    .text(`LAUDO MÉDICO | ${exame.tipoExame || 'Exame'}`,
      styles.margins.left, 100);

  // Linha divisória
  doc.moveTo(styles.margins.left, 125)
    .lineTo(doc.page.width - styles.margins.right, 125)
    .lineWidth(1)
    .stroke(styles.colors.gray);

  // Funções auxiliares
  const formatValue = (value, suffix = '') => {
    if (value === undefined || value === null) return 'Não informado';
    return `${value}${suffix}`;
  };
  const drawLabelValue = (label, value, x, y) => {
    doc.fillColor(styles.colors.text)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.label)
      .text(label, x, y);

    doc.font('Helvetica')
      .fontSize(styles.fonts.normal)
      .text(value, x + doc.widthOfString(label) + 2, y);

    return y + 18;
  };

  // Dados do paciente e exame
  let currentY = 140;
  let pacienteY = currentY;
  pacienteY = drawLabelValue('Nome: ', exame?.paciente?.nome || 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('CPF: ', exame?.paciente?.cpf || 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Nascimento: ', exame?.paciente?.dataNascimento ?
    new Date(exame.paciente.dataNascimento).toLocaleDateString('pt-BR') : 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Idade: ', exame?.paciente?.dataNascimento ?
    calcularIdade(exame.paciente.dataNascimento) + ' anos' : 'Não informado', styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Altura: ', formatValue(exame?.altura, ' cm'), styles.margins.left, pacienteY);
  pacienteY = drawLabelValue('Peso: ', formatValue(exame?.peso, ' kg'), styles.margins.left, pacienteY);

  let exameY = currentY;
  const column2X = doc.page.width / 2;
  exameY = drawLabelValue('Data do Exame: ', exame?.dataExame ?
    new Date(exame.dataExame).toLocaleDateString('pt-BR') : 'Não informado', column2X, exameY);
  exameY = drawLabelValue('Médico: ', medicoNome || 'Não informado', column2X, exameY);
  if (exame?.frequenciaCardiaca) {
    exameY = drawLabelValue('FC: ', formatValue(exame.frequenciaCardiaca, ' bpm'), column2X, exameY);
  }
  if (exame?.segmentoPR) {
    exameY = drawLabelValue('PR: ', formatValue(exame.segmentoPR, ' ms'), column2X, exameY);
  }
  if (exame?.duracaoQRS) {
    exameY = drawLabelValue('QRS: ', formatValue(exame.duracaoQRS, ' ms'), column2X, exameY);
  }

  currentY = Math.max(pacienteY, exameY) + styles.spacing.section;

  // Divisão antes da conclusão
  doc.moveTo(styles.margins.left, currentY)
    .lineTo(doc.page.width - styles.margins.right, currentY)
    .lineWidth(1)
    .stroke(styles.colors.gray);

  currentY += styles.spacing.section;

  // Seção de conclusão
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.section)
    .text('ANÁLISE E CONCLUSÃO', styles.margins.left, currentY);

  currentY += styles.spacing.paragraph;

  // Conclusão formatada - CORRIGIDA
  const conclusaoParagrafos = conclusao?.split('\n') || ['Não informado'];
  conclusaoParagrafos.forEach(paragrafo => {
    if (paragrafo.trim().length > 0) {
      const height = doc.heightOfString(paragrafo, {
        width: doc.page.width - styles.margins.left - styles.margins.right,
        align: 'justify'
      });

      if (currentY + height > doc.page.height - 180) {
        doc.addPage();
        currentY = styles.margins.top;
        addHeader();
      }

      doc.fillColor(styles.colors.text)
        .font('Helvetica')
        .fontSize(styles.fonts.normal)
        .text(paragrafo, styles.margins.left, currentY, {
          width: doc.page.width - styles.margins.left - styles.margins.right,
          align: 'justify',
          lineGap: styles.spacing.line
        });

      currentY += height + styles.spacing.paragraph;
    }
  });

  return currentY;
}

// Helper function to handle encryption
const encryptFields = (data) => {
    const fieldsToEncrypt = ['conteudo', 'conclusao', 'observacoes'];
    const encrypted = { ...data };
    
    fieldsToEncrypt.forEach(field => {
        if (encrypted[field]) {
            encrypted[field] = encrypt(encrypted[field]);
        }
    });
    
    return encrypted;
};

// Helper function to handle decryption
const decryptFields = (data) => {
    const fieldsToDecrypt = ['conteudo', 'conclusao', 'observacoes'];
    const decrypted = { ...data };
    
    fieldsToDecrypt.forEach(field => {
        if (decrypted[field]) {
            try {
                decrypted[field] = decrypt(decrypted[field]);
            } catch (err) {
                console.error(`Error decrypting ${field}:`, err);
            }
        }
    });
    
    return decrypted;
};

// Função para gerar PDF assinado - CORRIGIDA
exports.gerarPdfLaudoAssinado = async (laudoId, exame, tipoExame, medicoNome, medicoId, conclusao) => {
  try {
    const laudo = await Laudo.findById(laudoId).populate('exame');
    const usuarioMedico = await Usuario.findById(medicoId).populate('crm');

    const pdfBuffers = [];
    const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true });
    doc.on('data', chunk => pdfBuffers.push(chunk));

    // Adiciona selo visual no PDF
    doc.rect(400, 750, 150, 50)
       .stroke()
       .font('Helvetica-Bold')
       .fontSize(8)
       .fillColor('red')
       .text('DOCUMENTO ASSINADO DIGITALMENTE\nValidar autenticidade no Adobe Reader', 405, 755, {
         width: 140,
         align: 'center'
       });

    // Gerar conteúdo do PDF
    await gerarConteudoPdfLaudo(doc, laudo, exame, usuarioMedico, medicoNome, conclusao, '', defaultStyles);

    await new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    const pdfBuffer = Buffer.concat(pdfBuffers);

    // Verificar se certificado existe
    if (!fs.existsSync(CERTIFICATE_PATH)) {
      console.warn('Certificado não encontrado, gerando PDF sem assinatura digital');
      
      // Upload direto sem assinatura
      const pdfFile = {
        buffer: pdfBuffer,
        originalname: `laudo_${laudoId}.pdf`,
        mimetype: 'application/pdf',
        size: pdfBuffer.length,
        stream: () => {
          const stream = new require('stream').Readable();
          stream.push(pdfBuffer);
          stream.push(null);
          return stream;
        }
      };

      const uploadcareUrl = await uploadPDFToUploadcare(pdfFile);
      return { success: true, fileUrl: uploadcareUrl };
    }

    try {
      // Importar signPdf dinamicamente
      const signPdfModule = await import('node-signpdf');
      
      // The correct way to access the sign function from dynamic import
      const signPdf = signPdfModule.default;
      
      // Carregar certificado e assinar
      const pfxBuffer = fs.readFileSync(CERTIFICATE_PATH);
      const passphrase = process.env.CERTIFICADO_PFX_SENHA || '';

      const pdfWithPlaceholder = plainAddPlaceholder({
        pdfBuffer,
        reason: 'Assinatura Digital Laudo Médico',
        name: medicoNome,
        location: 'Sistema LaudoFy',
      });

      // Sign the PDF with the correct function call
      const signedPdf = signPdf.sign(pdfWithPlaceholder, pfxBuffer, { passphrase });

      const pdfFile = {
        buffer: signedPdf,
        originalname: `laudo_assinado_${laudoId}.pdf`,
        mimetype: 'application/pdf',
        size: signedPdf.length,
        stream: () => {
          const stream = new require('stream').Readable();
          stream.push(signedPdf);
          stream.push(null);
          return stream;
        }
      };

      const uploadcareUrl = await uploadPDFToUploadcare(pdfFile);
      return { success: true, fileUrl: uploadcareUrl };
    } catch (signError) {
      console.error('Error signing PDF:', signError);
      
      // Fall back to unsigned PDF if signing fails
      const pdfFile = {
        buffer: pdfBuffer,
        originalname: `laudo_${laudoId}.pdf`,
        mimetype: 'application/pdf',
        size: pdfBuffer.length,
        stream: () => {
          const stream = new require('stream').Readable();
          stream.push(pdfBuffer);
          stream.push(null);
          return stream;
        }
      };

      const uploadcareUrl = await uploadPDFToUploadcare(pdfFile);
      return { success: true, fileUrl: uploadcareUrl, signed: false };
    }
  } catch (err) {
    console.error('Erro na assinatura digital:', err);
    throw err;
  }
};

// --- CRIAÇÃO DO LAUDO JÁ ASSINADO ---
exports.criarLaudo = async (req, res) => {
  let laudo;
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { exameId, conclusao } = req.body;
    const usuarioId = req.usuario.id;
    const usuarioNome = req.usuarioNome;

    console.log("Creating Laudo with usuarioId:", usuarioId, "and usuarioNome:", usuarioNome);

    if (!exameId || !conclusao) {
      return res.status(400).json({ erro: 'Exame e conclusão são obrigatórios' });
    }

    const exame = await Exame.findById(exameId)
      .populate('paciente')
      .populate('tipoExame');

    if (!exame) {
      return res.status(404).json({ erro: 'Exame não encontrado' });
    }

    const tenantId = exame.tenant_id;

    const laudoExistente = await Laudo.findOne({ exame: exameId, valido: true });
    if (laudoExistente) {
      return res.status(400).json({ erro: 'Já existe um laudo válido para este exame' });
    }

    const gerarCodigoAcesso = () => Math.floor(1000 + Math.random() * 9000).toString();
    const codigoAcesso = gerarCodigoAcesso();

    // Buscar médico para obter especialidade
    const medico = await Usuario.findById(usuarioId).populate('especialidades');

    // Cria o laudo já assinado
    const laudoData = {
      exame: exameId,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao,
      status: 'Laudo assinado',
      valido: true,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      codigoAcesso,
      tenant_id: tenantId,
      tipoExameId: exame.tipoExame,
      especialidadeId: medico?.especialidades?.[0] || null
    };

    // Encrypt sensitive fields
    const encryptedData = encryptFields(laudoData);

    laudo = new Laudo(encryptedData);

    // Calcular valor do laudo se os IDs necessários estão disponíveis
    if (laudo.tipoExameId && laudo.especialidadeId) {
      await laudo.calcularValorPago();
    }

    await laudo.save();

    exame.status = 'Laudo realizado';
    exame.laudo = laudo._id;
    await exame.save();

    await AuditLog.create({
      userId: usuarioId,
      action: 'create',
      description: `Novo laudo criado para exame ${exameId}`,
      collectionName: 'laudos',
      documentId: laudo._id,
      before: null,
      after: laudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: exame.paciente._id,
        tipoExame: exame.tipoExame.nome
      },
      tenant_id: tenantId
    });

    // Gera o PDF assinado
    const resultado = await exports.gerarPdfLaudoAssinado(
      laudo._id,
      exame,
      exame.tipoExame,
      usuarioNome,
      usuarioId,
      conclusao
    );

    laudo.laudoAssinado = resultado.fileUrl;
    laudo.dataAssinatura = new Date();
    await laudo.save();

    res.status(201).json({
      mensagem: 'Laudo criado e assinado com sucesso',
      laudo: {
        id: laudo._id,
        exame: exameId,
        status: laudo.status,
        criadoEm: laudo.createdAt,
        laudoAssinado: laudo.laudoAssinado,
        valorPago: laudo.valorPago
      },
      valido: true
    });

  } catch (err) {
    logger.error('Erro ao criar laudo:', err);

    if (laudo?._id) {
      await Laudo.findByIdAndUpdate(laudo._id, {
        status: 'Erro ao gerar PDF'
      });
    }

    res.status(500).json({
      erro: 'Erro ao criar laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// --- REFAZER LAUDO ---
exports.refazerLaudo = async (req, res) => {
  let novoLaudo;
  try {
    const laudoId = req.params.id;
    const { conclusao } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;
    const tenantId = req.tenant_id;

    // Busca o laudo original
    const laudoOriginal = await Laudo.findById(laudoId).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });

    if (!laudoOriginal) {
      return res.status(404).json({ erro: 'Laudo original não encontrado' });
    }

    // Cria novo laudo (nova versão)
    const gerarCodigoAcesso = () => Math.floor(1000 + Math.random() * 9000).toString();
    const codigoAcesso = gerarCodigoAcesso();

    novoLaudo = new Laudo({
      exame: laudoOriginal.exame._id,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao: conclusao || laudoOriginal.conclusao,
      status: 'Laudo assinado',
      valido: true,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      codigoAcesso,
      historico: [
        ...(laudoOriginal.historico || []),
        {
          data: new Date(),
          usuario: usuarioId,
          nomeUsuario: usuarioNome,
          acao: 'Refação',
          detalhes: 'Laudo refeito',
          versao: (laudoOriginal.historico?.length || 0) + 1
        }
      ],
      tenant_id: tenantId,
      tipoExameId: laudoOriginal.tipoExameId,
      especialidadeId: laudoOriginal.especialidadeId
    });

    // Calcular valor do novo laudo
    if (novoLaudo.tipoExameId && novoLaudo.especialidadeId) {
      await novoLaudo.calcularValorPago();
    }

    await novoLaudo.save();

    // Atualiza exame para apontar para o novo laudo
    laudoOriginal.exame.laudo = novoLaudo._id;
    laudoOriginal.exame.status = 'Laudo realizado';
    await laudoOriginal.exame.save();

    // Auditoria
    await AuditLog.create({
      userId: usuarioId,
      action: 'recreate',
      description: `Laudo refeito para exame ${laudoOriginal.exame._id}`,
      collectionName: 'laudos',
      documentId: novoLaudo._id,
      before: laudoOriginal.toObject(),
      after: novoLaudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: laudoOriginal.exame.paciente._id,
        tipoExame: laudoOriginal.exame.tipoExame.nome
      },
      tenant_id: tenantId
    });

    // Gera o PDF assinado
    const resultado = await exports.gerarPdfLaudoAssinado(
      novoLaudo._id,
      laudoOriginal.exame,
      laudoOriginal.exame.tipoExame,
      usuarioNome,
      usuarioId,
      novoLaudo.conclusao
    );

    novoLaudo.laudoAssinado = resultado.fileUrl;
    novoLaudo.dataAssinatura = new Date();
    await novoLaudo.save();

    res.status(201).json({
      mensagem: 'Laudo refeito e assinado com sucesso',
      laudo: {
        id: novoLaudo._id,
        exame: laudoOriginal.exame._id,
        status: novoLaudo.status,
        criadoEm: novoLaudo.createdAt,
        laudoAssinado: novoLaudo.laudoAssinado,
        valorPago: novoLaudo.valorPago
      },
      valido: true
    });

  } catch (err) {
    logger.error('Erro ao refazer laudo:', err);

    if (novoLaudo?._id) {
      await Laudo.findByIdAndUpdate(novoLaudo._id, {
        status: 'Erro ao gerar PDF'
      });
    }

    res.status(500).json({
      erro: 'Erro ao refazer laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Listar laudos por paciente
exports.listarLaudosPorPaciente = async (req, res) => {
  try {
    const pacienteId = req.params.id;
    const laudos = await Laudo.find({ 'exame.paciente': pacienteId, tenant_id: req.tenant_id }).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });
    res.json(laudos);
  } catch (err) {
    logger.error('Erro ao listar laudos por paciente:', err);
    res.status(500).json({ erro: 'Erro ao listar laudos por paciente' });
  }
};

// Listar todos os laudos - FILTRO DE PACIENTE CORRIGIDO
exports.listarLaudos = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort || '-createdAt';
    const skip = (page - 1) * limit;

    console.log('=== LISTAR LAUDOS ===');
    console.log('Query params:', req.query);
    console.log('Usuario:', { id: req.usuario.id, role: req.usuario.role, tenant_id: req.tenant_id });

    // Build base query
    const baseQuery = {};
    
    // Filtrar por role do usuário
    if (req.usuario.role === 'medico') {
      baseQuery.medicoResponsavelId = req.usuario.id;
      console.log('Filtro médico aplicado:', req.usuario.id);
    } else if (req.usuario.role !== 'adminMaster') {
      if (Array.isArray(req.tenant_id)) {
        baseQuery.tenant_id = { $in: req.tenant_id };
      } else {
        baseQuery.tenant_id = req.tenant_id;
      }
      console.log('Filtro tenant aplicado:', req.tenant_id);
    }
    
    // Aplicar filtros básicos
    if (req.query.status && req.query.status.trim() !== '') {
      baseQuery.status = req.query.status.trim();
      console.log('Filtro status aplicado:', req.query.status);
    }
    
    if (req.query.exameId && req.query.exameId.trim() !== '') {
      baseQuery.exame = req.query.exameId.trim();
      console.log('Filtro exameId aplicado:', req.query.exameId);
    }

    // Filtro de datas
    if (req.query.dataInicio || req.query.dataFim) {
      baseQuery.createdAt = {};
      if (req.query.dataInicio && req.query.dataInicio.trim() !== '') {
        baseQuery.createdAt.$gte = new Date(req.query.dataInicio);
        console.log('Filtro dataInicio aplicado:', req.query.dataInicio);
      }
      if (req.query.dataFim && req.query.dataFim.trim() !== '') {
        const dataFim = new Date(req.query.dataFim);
        dataFim.setHours(23, 59, 59, 999);
        baseQuery.createdAt.$lte = dataFim;
        console.log('Filtro dataFim aplicado:', req.query.dataFim);
      }
    }

    // NOVA ABORDAGEM: Buscar primeiro os pacientes pelo nome e depois os laudos
    let laudos, total;

    if (req.query.paciente && req.query.paciente.trim() !== '') {
      console.log('=== BUSCA POR PACIENTE ===');
      const termoPaciente = req.query.paciente.trim();
      console.log('Termo de busca:', termoPaciente);

      // Primeiro, buscar todos os pacientes que correspondem ao filtro
      const Paciente = require('../models/Paciente');
      
      // Como o nome está criptografado, vamos buscar todos os pacientes 
      // e descriptografar no lado da aplicação
      console.log('Buscando pacientes...');
      const pacientes = await Paciente.find({}).select('_id nome');
      
      console.log(`Total de pacientes encontrados: ${pacientes.length}`);
      
      // Filtrar pacientes cujo nome descriptografado contém o termo
      const pacientesMatched = [];
      
      for (const paciente of pacientes) {
        try {
          // Usar o getter que já descriptografa
          const nomeDescriptografado = paciente.nome; // O getter do modelo faz a descriptografia
          
          if (nomeDescriptografado && 
              nomeDescriptografado.toLowerCase().includes(termoPaciente.toLowerCase())) {
            pacientesMatched.push(paciente._id);
            console.log(`Paciente encontrado: ${nomeDescriptografado} (ID: ${paciente._id})`);
          }
        } catch (error) {
          console.error('Erro ao descriptografar nome do paciente:', error);
        }
      }
      
      console.log(`Pacientes que correspondem: ${pacientesMatched.length}`);
      
      if (pacientesMatched.length === 0) {
        // Nenhum paciente encontrado, retornar resultado vazio
        console.log('Nenhum paciente encontrado com o nome especificado');
        return res.json({
          laudos: [],
          page,
          limit,
          total: 0,
          totalPages: 0
        });
      }

      // Agora buscar os exames desses pacientes
      const Exame = require('../models/Exame');
      const exames = await Exame.find({ 
        paciente: { $in: pacientesMatched } 
      }).select('_id');
      
      const exameIds = exames.map(exame => exame._id);
      console.log(`Exames encontrados: ${exameIds.length}`);
      
      if (exameIds.length === 0) {
        console.log('Nenhum exame encontrado para os pacientes especificados');
        return res.json({
          laudos: [],
          page,
          limit,
          total: 0,
          totalPages: 0
        });
      }

      // Adicionar filtro de exames à query base
      baseQuery.exame = { $in: exameIds };
    }

    // Filtro adicional para médico por ID
    if (req.query.medicoId && req.query.medicoId.trim() !== '' && mongoose.isValidObjectId(req.query.medicoId)) {
      baseQuery.medicoResponsavelId = req.query.medicoId.trim();
      console.log('Filtro medicoId (ObjectId) aplicado:', req.query.medicoId);
    }

    // Query com populate
    console.log('Query final para laudos:', baseQuery);
    
    [laudos, total] = await Promise.all([
      Laudo.find(baseQuery)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'exame',
          populate: [
            {
              path: 'paciente',
              select: 'nome idade dataNascimento email cpf'
            },
            {
              path: 'tipoExame',
              select: 'nome'
            }
          ]
        })
        .populate('medicoResponsavelId', 'nome crm')
        .populate('tenant_id', 'nomeFantasia'),
      Laudo.countDocuments(baseQuery)
    ]);

    console.log('Laudos encontrados:', laudos.length);
    console.log('Total de laudos:', total);

    // Converter para JSON e garantir que os getters sejam aplicados corretamente
    const laudosFormatted = laudos.map(laudo => {
      // Usar toJSON() para aplicar todos os getters e transform
      const laudoJson = laudo.toJSON();
      
      // Garantir estrutura correta do exame
      if (laudoJson.exame?.tipoExame && typeof laudoJson.exame.tipoExame === 'string') {
        laudoJson.exame.tipoExame = { nome: 'Tipo não informado' };
      }

      // Verificar se a conclusão foi descriptografada corretamente
      if (laudoJson.conclusao && typeof laudoJson.conclusao === 'string' && laudoJson.conclusao.includes(':')) {
        try {
          laudoJson.conclusao = decrypt(laudoJson.conclusao) || laudoJson.conclusao;
        } catch (error) {
          console.error('Erro ao descriptografar conclusão:', error);
        }
      }

      // Garantir descriptografia do nome do paciente
      if (laudoJson.exame?.paciente?.nome && typeof laudoJson.exame.paciente.nome === 'string' && laudoJson.exame.paciente.nome.includes(':')) {
        try {
          laudoJson.exame.paciente.nome = decrypt(laudoJson.exame.paciente.nome) || laudoJson.exame.paciente.nome;
        } catch (error) {
          console.error('Erro ao descriptografar nome do paciente:', error);
        }
      }

      return laudoJson;
    });

    console.log('Primeiro laudo formatado:', {
      id: laudosFormatted[0]?._id,
      conclusao: laudosFormatted[0]?.conclusao?.substring(0, 50) + '...',
      medicoResponsavel: laudosFormatted[0]?.medicoResponsavel,
      status: laudosFormatted[0]?.status,
      paciente: laudosFormatted[0]?.exame?.paciente?.nome || 'Não informado'
    });

    res.json({
      laudos: laudosFormatted,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error('Error listing reports:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({
      message: 'Error retrieving reports',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Obter um laudo por ID - CORRIGIDO
exports.obterLaudo = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.usuario; // CORRIGIDO: era req.user

    console.log('=== OBTER LAUDO ===');
    console.log('Laudo ID:', id);
    console.log('Usuario:', { id: user.id, role: user.role, tenant_id: req.tenant_id });

    // Validar ObjectId
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID do laudo inválido' });
    }

    let query = { _id: id };

    // AdminMaster pode acessar qualquer laudo
    if (user.role !== 'adminMaster') {
      // Para outros usuários, aplicar filtro de tenant
      if (Array.isArray(req.tenant_id)) {
        query.tenant_id = { $in: req.tenant_id };
      } else {
        query.tenant_id = req.tenant_id;
      }
      console.log('Filtro tenant aplicado:', req.tenant_id);
    }

    // Médicos só podem ver seus próprios laudos
    if (user.role === 'medico') {
      query.medicoResponsavelId = user.id;
      console.log('Filtro médico aplicado:', user.id);
    }

    console.log('Query final:', query);

    const laudo = await Laudo.findOne(query)
      .populate({
        path: 'exame',
        populate: [
          {
            path: 'paciente',
            select: 'nome dataNascimento email cpf endereco telefone'
          },
          {
            path: 'tipoExame',
            select: 'nome descricao'
          }
        ]
      })
      .populate('medicoResponsavelId', 'nome crm email especialidades')
      .populate('tenant_id', 'nomeFantasia cnpj status');

    if (!laudo) {
      console.log('Laudo não encontrado com a query:', query);
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    console.log('Laudo encontrado:', {
      id: laudo._id,
      exame: laudo.exame?._id,
      paciente: laudo.exame?.paciente?._id,
      pacienteNome: laudo.exame?.paciente?.nome,
      tenant: laudo.tenant_id?._id,
      medicoResponsavel: laudo.medicoResponsavel
    });

    // Converter para JSON para aplicar getters
    const laudoJson = laudo.toJSON();

    // Verificar e descriptografar campos sensíveis do laudo
    const fieldsToCheck = ['conclusao', 'medicoResponsavel', 'laudoOriginal', 'laudoAssinado', 'observacoesPagamento'];
    
    fieldsToCheck.forEach(field => {
      if (laudoJson[field] && typeof laudoJson[field] === 'string' && laudoJson[field].includes(':')) {
        try {
          laudoJson[field] = decrypt(laudoJson[field]) || laudoJson[field];
        } catch (error) {
          console.error(`Erro ao descriptografar ${field}:`, error);
        }
      }
    });

    // Garantir que os dados do paciente estejam descriptografados
    if (laudoJson.exame?.paciente) {
      const paciente = laudoJson.exame.paciente;
      
      // Verificar se os campos do paciente precisam ser descriptografados
      const pacienteFields = ['nome', 'cpf', 'endereco', 'telefone', 'email'];
      
      pacienteFields.forEach(field => {
        if (paciente[field] && typeof paciente[field] === 'string' && paciente[field].includes(':')) {
          try {
            paciente[field] = decrypt(paciente[field]) || paciente[field];
          } catch (error) {
            console.error(`Erro ao descriptografar paciente.${field}:`, error);
          }
        }
      });

      // Calcular idade se dataNascimento existir
      if (paciente.dataNascimento) {
        try {
          const dataNasc = new Date(paciente.dataNascimento);
          if (!isNaN(dataNasc)) {
            const hoje = new Date();
            let idade = hoje.getFullYear() - dataNasc.getFullYear();
            const m = hoje.getMonth() - dataNasc.getMonth();
            if (m < 0 || (m === 0 && hoje.getDate() < dataNasc.getDate())) {
              idade--;
            }
            paciente.idade = idade;
          }
        } catch (error) {
          console.error('Erro ao calcular idade:', error);
        }
      }
    }

    // Garantir que os dados do exame estejam descriptografados
    if (laudoJson.exame) {
      const exame = laudoJson.exame;
      
      // Verificar se os campos do exame precisam ser descriptografados
      const exameFields = ['arquivo', 'sintomas', 'status'];
      
      exameFields.forEach(field => {
        if (exame[field] && typeof exame[field] === 'string' && exame[field].includes(':')) {
          try {
            exame[field] = decrypt(exame[field]) || exame[field];
          } catch (error) {
            console.error(`Erro ao descriptografar exame.${field}:`, error);
          }
        }
      });
    }

    // Descriptografar histórico
    if (laudoJson.historico && Array.isArray(laudoJson.historico)) {
      laudoJson.historico = laudoJson.historico.map(item => {
        const historicoFields = ['usuario', 'nomeUsuario', 'detalhes', 'destinatarioEmail', 'mensagemErro'];
        
        historicoFields.forEach(field => {
          if (item[field] && typeof item[field] === 'string' && item[field].includes(':')) {
            try {
              item[field] = decrypt(item[field]) || item[field];
            } catch (error) {
              console.error(`Erro ao descriptografar historico.${field}:`, error);
            }
          }
        });
        
        return item;
      });
    }

    console.log('Dados finais:', {
      pacienteNome: laudoJson.exame?.paciente?.nome,
      tipoExame: laudoJson.exame?.tipoExame?.nome,
      tenantNome: laudoJson.tenant_id?.nomeFantasia,
      conclusao: laudoJson.conclusao?.substring(0, 50) + '...',
      medicoResponsavel: laudoJson.medicoResponsavel
    });

    res.json(laudoJson);
  } catch (err) {
    console.error('Erro ao obter laudo:', err);
    logger.error('Erro ao obter laudo:', err);
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Histórico de versões do laudo
exports.getHistoricoLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    res.json(laudo.historico || []);
  } catch (err) {
    logger.error('Erro ao obter histórico do laudo:', err);
    res.status(500).json({ erro: 'Erro ao obter histórico do laudo' });
  }
};

// Gerar PDF do laudo (original, sem assinatura)
exports.gerarPdfLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id).populate({
      path: 'exame',
      populate: { path: 'paciente tipoExame' }
    });
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao gerar PDF do laudo:', err);
    res.status(500).json({ erro: 'Erro ao gerar PDF do laudo' });
  }
};

// Download do laudo original
exports.downloadLaudoOriginal = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo || !laudo.laudoOriginal) {
      return res.status(404).json({ erro: 'Arquivo original não encontrado' });
    }
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao baixar laudo original:', err);
    res.status(500).json({ erro: 'Erro ao baixar laudo original' });
  }
};

// Download do laudo assinado
exports.downloadLaudoAssinado = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo || !laudo.laudoAssinado) {
      return res.status(404).json({ erro: 'Arquivo assinado não encontrado' });
    }
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao baixar laudo assinado:', err);
    res.status(500).json({ erro: 'Erro ao baixar laudo assinado' });
  }
};

// Estatísticas de laudos
exports.getEstatisticas = async (req, res) => {
  try {
    const total = await Laudo.countDocuments();
    const assinados = await Laudo.countDocuments({ status: 'Laudo assinado' });
    res.json({ total, assinados });
  } catch (err) {
    logger.error('Erro ao obter estatísticas:', err);
    res.status(500).json({ erro: 'Erro ao obter estatísticas' });
  }
};

// Relatório de laudos por status
exports.getLaudosPorStatus = async (req, res) => {
  try {
    const stats = await Laudo.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    res.json(stats);
  } catch (err) {
    logger.error('Erro ao obter relatório por status:', err);
    res.status(500).json({ erro: 'Erro ao obter relatório por status' });
  }
};

// Listar laudos por exame
exports.getLaudosPorExame = async (req, res) => {
  try {
    const exameId = req.params.id;
    const laudos = await Laudo.find({ exame: exameId });
    res.json(laudos);
  } catch (err) {
    logger.error('Erro ao listar laudos por exame:', err);
    res.status(500).json({ erro: 'Erro ao listar laudos por exame' });
  }
};

// Enviar laudo por e-mail
exports.enviarEmailLaudo = async (req, res) => {
  try {
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao enviar laudo por e-mail:', err);
    res.status(500).json({ erro: 'Erro ao enviar laudo por e-mail' });
  }
};

// Visualizar laudo público
exports.visualizarLaudoPublico = async (req, res) => {
  try {
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao visualizar laudo público:', err);
    res.status(500).json({ erro: 'Erro ao visualizar laudo público' });
  }
};

// Autenticar laudo público
exports.autenticarLaudoPublico = async (req, res) => {
  try {
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao autenticar laudo público:', err);
    res.status(500).json({ erro: 'Erro ao autenticar laudo público' });
  }
};

// Invalidar laudo
exports.invalidarLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findByIdAndUpdate(
      req.params.id,
      { valido: false, status: 'Invalidado' },
      { new: true }
    );
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }
    res.json({ mensagem: 'Laudo invalidado com sucesso', laudo });
  } catch (err) {
    logger.error('Erro ao invalidar laudo:', err);
    res.status(500).json({ erro: 'Erro ao invalidar laudo' });
  }
};

// Gerar relatório (exemplo)
exports.gerarRelatorio = async (req, res) => {
  try {
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao gerar relatório:', err);
    res.status(500).json({ erro: 'Erro ao gerar relatório' });
  }
};

// Exportar relatório em PDF (exemplo)
exports.relatorioPdf = async (req, res) => {
  try {
    res.status(501).json({ erro: 'Função não implementada neste exemplo' });
  } catch (err) {
    logger.error('Erro ao exportar relatório PDF:', err);
    res.status(500).json({ erro: 'Erro ao exportar relatório PDF' });
  }
};

// Get report statistics
exports.obterEstatisticas = async (req, res) => {
  try {
    const { dataInicio, dataFim } = req.query;
    const query = { tenant_id: req.tenant_id };

    if (dataInicio || dataFim) {
      query.dataCriacao = {};
      if (dataInicio) query.dataCriacao.$gte = new Date(dataInicio);
      if (dataFim) query.dataCriacao.$lte = new Date(dataFim);
    }

    const [
      totalLaudos,
      laudosPorStatus,
      laudosPorMedico,
      tempoMedioElaboracao
    ] = await Promise.all([
      Laudo.countDocuments(query),
      Laudo.aggregate([
        { $match: query },
        { $group: { _id: "$status", total: { $sum: 1 } } }
      ]),
      Laudo.aggregate([
        { $match: query },
        { 
          $group: { 
            _id: "$medicoResponsavel",
            total: { $sum: 1 },
            finalizados: {
              $sum: { $cond: [{ $eq: ["$status", "Finalizado"] }, 1, 0] }
            },
            tempoMedio: {
              $avg: {
                $cond: [
                  { $and: [
                    { $eq: ["$status", "Finalizado"] },
                    { $exists: ["$dataFinalizacao", true] }
                  ]},
                  { $subtract: ["$dataFinalizacao", "$dataCriacao"] },
                  null
                ]
              }
            }
          }
        },
        {
          $lookup: {
            from: "usuarios",
            localField: "_id",
            foreignField: "_id",
            as: "medicoInfo"
          }
        },
        { $unwind: "$medicoInfo" },
        {
          $project: {
            nome: "$medicoInfo.nome",
            especialidade: "$medicoInfo.especialidade",
            total: 1,
            finalizados: 1,
            tempoMedioHoras: {
              $divide: ["$tempoMedio", 3600000]
            }
          }
        }
      ]),
      Laudo.aggregate([
        {
          $match: {
            ...query,
            status: "Finalizado",
            dataFinalizacao: { $exists: true }
          }
        },
        {
          $group: {
            _id: null,
            tempoMedio: {
              $avg: { $subtract: ["$dataFinalizacao", "$dataCriacao"] }
            }
          }
        }
      ])
    ]);

    res.json({
      totalLaudos,
      laudosPorStatus,
      laudosPorMedico,
      tempoMedioElaboracao: tempoMedioElaboracao[0]?.tempoMedio || 0
    });
  } catch (err) {
    console.error('Error retrieving report statistics:', err);
    res.status(500).json({
      message: 'Error retrieving report statistics',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};