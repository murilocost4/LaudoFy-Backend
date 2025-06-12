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
const { 
  uploadLaudoToS3, 
  deleteLaudoFromS3, 
  getSignedUrlForLaudo,
  uploadLaudoStreamToS3 
} = require('../services/laudoStorageService');
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
  console.error('Could not create directories:');
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

// Função auxiliar para obter laudo com dados descriptografados
const obterLaudoPorId = async (laudoId) => {
  const laudo = await Laudo.findById(laudoId)
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
    .populate('tenant_id', 'nomeFantasia razaoSocial cnpj endereco telefone email');

  if (!laudo) {
    return null;
  }

  // Converter para JSON usando toObject para aplicar getters
  const laudoJson = laudo.toObject();

  // Descriptografar campos do laudo (verificar se ainda estão criptografados)
  const laudoFields = ['conclusao', 'medicoResponsavel'];
  laudoFields.forEach(field => {
    if (laudoJson[field] && typeof laudoJson[field] === 'string' && laudoJson[field].includes(':')) {
      try {
        laudoJson[field] = decrypt(laudoJson[field]) || laudoJson[field];
      } catch (error) {
        console.error(`Erro ao descriptografar laudo.${field}:`);
      }
    }
  });

  // Descriptografar dados do paciente
  if (laudoJson.exame?.paciente) {
    const paciente = laudoJson.exame.paciente;
    
    // Verificar se os campos do paciente precisam ser descriptografados
    const pacienteFields = ['nome', 'cpf', 'endereco', 'telefone', 'email', 'dataNascimento'];
    
    pacienteFields.forEach(field => {
      if (paciente[field] && typeof paciente[field] === 'string' && paciente[field].includes(':')) {
        try {
          paciente[field] = decrypt(paciente[field]) || paciente[field];
        } catch (error) {
          console.error(`Erro ao descriptografar paciente.${field}:`);
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
        console.error('Erro ao calcular idade:');
      }
    }
  }

  // Descriptografar dados do exame
  if (laudoJson.exame) {
    const exame = laudoJson.exame;
    
    // Verificar se os campos do exame precisam ser descriptografados
    const exameFields = ['arquivo', 'observacoes', 'status', 'altura', 'peso', 'frequenciaCardiaca', 'segmentoPR', 'duracaoQRS'];
    
    exameFields.forEach(field => {
      if (exame[field] && typeof exame[field] === 'string' && exame[field].includes(':')) {
        try {
          exame[field] = decrypt(exame[field]) || exame[field];
        } catch (error) {
          console.error(`Erro ao descriptografar exame.${field}:`);
        }
      }
    });
  }

  return laudoJson;
};

// Define default styles if none are provided - OTIMIZADO PARA UMA PÁGINA
const defaultStyles = {
  colors: {
    primary: '#334155',    // Slate 700 - mais escuro
    secondary: '#475569',  // Slate 600
    accent: '#64748b',     // Slate 500
    light: '#ffffff',
    dark: '#0f172a',       // Slate 900
    gray: '#64748b',       // Slate 500
    text: '#1e293b',       // Slate 800
    lightText: '#475569',  // Slate 600
    background: '#f8fafc', // Slate 50
    border: '#cbd5e1',     // Slate 300
    success: '#059669',    // Emerald 600
    warning: '#d97706',    // Amber 600
    error: '#dc2626'       // Red 600
  },
  margins: {
    left: 40,
    right: 40,
    headerRight: 40,
    top: 30,        // Reduzido
    bottom: 30      // Reduzido
  },
  fonts: {
    small: 8,       // Reduzido
    normal: 10,     // Reduzido
    label: 9,       // Reduzido
    title: 16,      // Reduzido
    section: 12,    // Reduzido
    large: 14       // Reduzido
  },
  spacing: {
    section: 18,    // Reduzido
    paragraph: 12,  // Reduzido
    line: 6,        // Reduzido
    header: 15,     // Reduzido
    element: 10     // Reduzido
  }
};

// Função base para gerar o conteúdo do PDF do laudo - MELHORADA
async function gerarConteudoPdfLaudo(doc, laudo, exame, usuarioMedico, medicoNome, conclusao, publicLink, styles) {
  // Ensure styles is defined with required properties
  styles = {
    ...defaultStyles,
    ...(styles || {})
  };

  // Os dados já vêm descriptografados através da função obterLaudoPorId
  const laudoDescriptografado = laudo;
  const exameDescriptografado = exame;
  const pacienteDescriptografado = exame?.paciente;

  // Cabeçalho moderno com gradiente sutil
  const addHeader = () => {
    // Fundo principal do cabeçalho
    doc.fillColor(styles.colors.primary)
      .rect(0, 0, doc.page.width, 90)
      .fill();
    
    // Linha de destaque superior
    doc.fillColor(styles.colors.secondary)
      .rect(0, 0, doc.page.width, 4)
      .fill();

    // Logo
    if (LOGO_PATH && fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, styles.margins.left, 20, { height: 45 });
    } else {
      doc.fillColor(styles.colors.light)
        .font('Helvetica-Bold')
        .fontSize(22)
        .text('LAUDOFY', styles.margins.left, 35);
    }

    // Informações do lado direito
    const rightTextX = doc.page.width - styles.margins.headerRight - 150;
    
    // Box de informações do laudo
    doc.fillColor(styles.colors.light)
      .rect(rightTextX - 10, 15, 160, 60)
      .stroke(styles.colors.light)
      .lineWidth(1);
    
    doc.fillColor(styles.colors.light)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.small)
      .text('LAUDO MÉDICO', rightTextX, 25, { align: 'left' })
      .font('Helvetica')
      .fontSize(styles.fonts.small)
      .text(`Nº ${laudoDescriptografado._id?.toString().substring(0, 8) || 'N/A'}`, rightTextX, 40, { align: 'left' })
      .text(`Emitido: ${new Date().toLocaleDateString('pt-BR')}`, rightTextX, 55, { align: 'left' });
  };

  addHeader();

  // Logo de fundo mais sutil
  if (LOGO_LAUDOFY && fs.existsSync(LOGO_LAUDOFY)) {
    doc.opacity(0.03);
    doc.image(LOGO_LAUDOFY, doc.page.width / 2 - 250, doc.page.height / 2 - 250, { width: 500 });
    doc.opacity(1);
  }

  // Título principal com melhor espaçamento
  let currentY = 120;
  
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.title)
    .text(`LAUDO MÉDICO - ${exameDescriptografado.tipoExame?.nome || 'Exame'}`, styles.margins.left, currentY);

  currentY += styles.spacing.header;

  // Linha divisória estilizada
  doc.strokeColor(styles.colors.border)
    .lineWidth(2)
    .moveTo(styles.margins.left, currentY)
    .lineTo(doc.page.width - styles.margins.right, currentY)
    .stroke();

  currentY += styles.spacing.section;

  // Funções auxiliares melhoradas
  const formatValue = (value, suffix = '') => {
    if (value === undefined || value === null) return 'Não informado';
    return `${value}${suffix}`;
  };

  const drawSection = (title, content, startY) => {
    // Título da seção
    doc.fillColor(styles.colors.secondary)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.section)
      .text(title, styles.margins.left, startY);

    let sectionY = startY + styles.spacing.element + 5;
    
    // Fundo sutil para a seção
    const sectionHeight = content.length * 20 + 20;
    doc.fillColor(styles.colors.background)
      .rect(styles.margins.left - 5, sectionY - 5, doc.page.width - styles.margins.left - styles.margins.right + 10, sectionHeight)
      .fill();

    // Conteúdo da seção
    content.forEach(item => {
      doc.fillColor(styles.colors.lightText)
        .font('Helvetica-Bold')
        .fontSize(styles.fonts.label)
        .text(item.label, styles.margins.left, sectionY);

      doc.fillColor(styles.colors.text)
        .font('Helvetica')
        .fontSize(styles.fonts.normal)
        .text(item.value, styles.margins.left + 80, sectionY);

      sectionY += 20;
    });

    return sectionY + styles.spacing.element;
  };

  // Seção: Dados do Paciente
  const dadosPaciente = [
    { label: 'Nome:', value: pacienteDescriptografado?.nome || 'Não informado' },
    { label: 'CPF:', value: pacienteDescriptografado?.cpf || 'Não informado' }
  ];

  // Adicionar data de nascimento e idade com validação melhorada
  if (pacienteDescriptografado?.dataNascimento) {
    try {
      let dataProcessada;
      const dataNascString = String(pacienteDescriptografado.dataNascimento).trim();
      
      // Verificar diferentes formatos de data
      if (dataNascString.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Formato YYYY-MM-DD (ISO)
        const [ano, mes, dia] = dataNascString.split('-');
        dataProcessada = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      } else if (dataNascString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        // Formato DD/MM/YYYY (Brasil)
        const [dia, mes, ano] = dataNascString.split('/');
        dataProcessada = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      } else if (dataNascString.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
        // Formato YYYY/MM/DD
        const [ano, mes, dia] = dataNascString.split('/');
        dataProcessada = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
      } else if (dataNascString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
        // Formato ISO completo com horário
        dataProcessada = new Date(dataNascString);
      } else {
        // Tentar criar data diretamente
        dataProcessada = new Date(dataNascString);
      }
      
      // Verificar se a data é válida com validação mais flexível
      const anoAtual = new Date().getFullYear();
      if (!isNaN(dataProcessada.getTime()) && 
          dataProcessada.getFullYear() > 1900 && 
          dataProcessada.getFullYear() <= anoAtual &&
          dataProcessada.getMonth() >= 0 && 
          dataProcessada.getMonth() <= 11) {
        
        dadosPaciente.push({ 
          label: 'Nascimento:', 
          value: dataProcessada.toLocaleDateString('pt-BR') 
        });
        
        const idade = calcularIdade(dataProcessada);
        if (!isNaN(idade) && idade >= 0 && idade <= 150) {
          dadosPaciente.push({ 
            label: 'Idade:', 
            value: idade + ' anos' 
          });
        }
      } else {
        console.error('Data de nascimento inválida após processamento');
        dadosPaciente.push({ label: 'Nascimento:', value: 'Data inválida' });
      }
    } catch (error) {
      console.error('Erro ao processar data de nascimento:');
      dadosPaciente.push({ label: 'Nascimento:', value: 'Erro na data' });
    }
  } else {
    dadosPaciente.push({ label: 'Nascimento:', value: 'Não informado' });
  }

  // Adicionar dados opcionais do paciente
  if (pacienteDescriptografado?.email) {
    dadosPaciente.push({ label: 'Email:', value: pacienteDescriptografado.email });
  }

  // Adicionar dados do exame com validação
  if (exameDescriptografado?.altura) {
    const altura = parseFloat(exameDescriptografado.altura);
    if (!isNaN(altura)) {
      dadosPaciente.push({ label: 'Altura:', value: altura + ' cm' });
    }
  }
  
  if (exameDescriptografado?.peso) {
    const peso = parseFloat(exameDescriptografado.peso);
    if (!isNaN(peso)) {
      dadosPaciente.push({ label: 'Peso:', value: peso + ' kg' });
    }
  }

  currentY = drawSection('DADOS DO PACIENTE', dadosPaciente, currentY);

  // Seção: Dados do Exame
  const dadosExame = [
    { label: 'Data Exame:', value: exameDescriptografado?.dataExame ? 
      new Date(exameDescriptografado.dataExame).toLocaleDateString('pt-BR') : 'Não informado' },
    { label: 'Médico:', value: medicoNome || laudoDescriptografado.medicoResponsavel || 'Não informado' }
  ];

  // Adicionar dados médicos específicos se disponíveis
  if (exameDescriptografado?.frequenciaCardiaca) {
    const fc = parseFloat(exameDescriptografado.frequenciaCardiaca);
    if (!isNaN(fc)) {
      dadosExame.push({ label: 'FC:', value: fc + ' bpm' });
    }
  }
  
  if (exameDescriptografado?.segmentoPR) {
    const pr = parseFloat(exameDescriptografado.segmentoPR);
    if (!isNaN(pr)) {
      dadosExame.push({ label: 'PR:', value: pr + ' ms' });
    }
  }
  
  if (exameDescriptografado?.duracaoQRS) {
    const qrs = parseFloat(exameDescriptografado.duracaoQRS);
    if (!isNaN(qrs)) {
      dadosExame.push({ label: 'QRS:', value: qrs + ' ms' });
    }
  }

  // Adicionar CRM do médico se disponível
  if (usuarioMedico?.crm) {
    dadosExame.push({ label: 'CRM:', value: usuarioMedico.crm });
  }

  currentY = drawSection('DADOS DO EXAME', dadosExame, currentY);

  // Linha divisória antes da conclusão
  doc.strokeColor(styles.colors.border)
    .lineWidth(1)
    .moveTo(styles.margins.left, currentY)
    .lineTo(doc.page.width - styles.margins.right, currentY)
    .stroke();

  currentY += styles.spacing.section;

  // Seção de conclusão com destaque
  doc.fillColor(styles.colors.primary)
    .rect(styles.margins.left - 5, currentY - 5, doc.page.width - styles.margins.left - styles.margins.right + 10, 35)
    .fill();

  doc.fillColor(styles.colors.light)
    .font('Helvetica-Bold')
    .fontSize(styles.fonts.section)
    .text('ANÁLISE E CONCLUSÃO', styles.margins.left, currentY + 8);

  currentY += 45;

  // Conclusão formatada com melhor tipografia - usar conclusão descriptografada
  // Garantir que a conclusão seja descriptografada
  let conclusaoFinal = conclusao || laudoDescriptografado.conclusao || 'Conclusão não informada';
  
  // Se a conclusão ainda está criptografada, descriptografar
  if (typeof conclusaoFinal === 'string' && conclusaoFinal.includes(':')) {
    try {
      conclusaoFinal = decrypt(conclusaoFinal) || conclusaoFinal;
    } catch (error) {
      console.error('Erro ao descriptografar conclusão:');
    }
  }
  
  const conclusaoParagrafos = conclusaoFinal.split('\n') || ['Não informado'];
  
  conclusaoParagrafos.forEach(paragrafo => {
    if (paragrafo.trim().length > 0) {
      const height = doc.heightOfString(paragrafo, {
        width: doc.page.width - styles.margins.left - styles.margins.right,
        align: 'justify'
      });

      if (currentY + height > doc.page.height - 200) {
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

  // Adicionar link público e QR code de forma discreta no final da página
  if (publicLink && publicLink.trim() !== '') {
    // Guardar o QR code e link para adicionar no final
    doc._publicLinkInfo = {
      link: publicLink,
      shouldAdd: true
    };
  }

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
                console.error(`Error decrypting ${field}:`);
            }
        }
    });
    
    return decrypted;
};

// Função para adicionar texto de verificação no final do documento
function adicionarTextoVerificacaoFinal(doc, styles) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margemFinal = 30;
  
  const textoVerificacao = `Este documento foi assinado digitalmente com certificado ICP-Brasil e pode ser verificado ` +
    `em sistemas como Adobe Reader, Assinador GOV.BR, ou outros validadores de assinatura digital. ` +
    `A autenticidade e integridade do documento são garantidas pela assinatura criptográfica.`;
  
  // Posição no final da página
  const textoY = pageHeight - margemFinal - 30;
  
  // Caixa de fundo para o texto
  doc.fillColor('#f8fafc')
    .rect(styles.margins.left - 5, textoY - 10, pageWidth - styles.margins.left - styles.margins.right + 10, 40)
    .fill();
  
  doc.strokeColor('#e2e8f0')
    .lineWidth(0.5)
    .rect(styles.margins.left - 5, textoY - 10, pageWidth - styles.margins.left - styles.margins.right + 10, 40)
    .stroke();
  
  // Texto de verificação
  doc.fillColor('#475569')
    .font('Helvetica')
    .fontSize(8)
    .text(textoVerificacao, styles.margins.left, textoY, {
      width: pageWidth - styles.margins.left - styles.margins.right,
      align: 'justify',
      lineGap: 2
    });
  
  return textoY;
}

// Função para adicionar área de assinatura médica - VERSÃO OTIMIZADA PARA UMA PÁGINA
async function adicionarAreaAssinaturaMedica(doc, medicoNome, usuarioMedico, currentY, assinadoDigitalmente = false, dataAssinatura = null, certificadoInfo = null) {
  const styles = defaultStyles;
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const centerX = pageWidth / 2;
  
  // Calcular espaço necessário para assinatura + link público + margem
  const espacoNecessario = 120; // Reduzido para otimizar espaço
  
  // Verificar se há espaço na página atual
  if (currentY > pageHeight - espacoNecessario) {
    doc.addPage();
    currentY = styles.margins.top;
  }
  
  // Posição da assinatura (mais alta para deixar espaço para link público)
  const assinaturaY = pageHeight - 90; // Reduzido para otimizar espaço
  
  // Se assinado digitalmente, adicionar selo compacto
  if (assinadoDigitalmente) {
    const seloWidth = 260; // Reduzido
    const seloHeight = 35; // Reduzido
    const seloX = centerX - (seloWidth / 2);
    const seloY = assinaturaY - 65; // Ajustado para ficar mais compacto
    
    // Fundo do selo
    doc.fillColor('#f8fafc')
      .rect(seloX, seloY, seloWidth, seloHeight)
      .fill();
    
    // Borda do selo
    doc.strokeColor('#334155')
      .lineWidth(1)
      .rect(seloX, seloY, seloWidth, seloHeight)
      .stroke();
    
    // Linha de destaque superior do selo
    doc.fillColor('#475569')
      .rect(seloX, seloY, seloWidth, 2)
      .fill();
    
    // Ícone de verificação (círculo com check)
    const iconX = seloX + 12;
    const iconY = seloY + 18;
    
    doc.fillColor('#334155')
      .circle(iconX, iconY, 6)
      .fill();
    
    doc.strokeColor('#ffffff')
      .lineWidth(1.5)
      .moveTo(iconX - 3, iconY)
      .lineTo(iconX - 1, iconY + 2)
      .lineTo(iconX + 3, iconY - 2)
      .stroke();
    
    // Texto principal do selo (compacto)
    doc.fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('ASSINADO DIGITALMENTE', iconX + 15, seloY + 6);
    
    // Data/hora da assinatura (compacta)
    const dataFormatada = dataAssinatura ? 
      new Date(dataAssinatura).toLocaleString('pt-BR') : 
      new Date().toLocaleString('pt-BR');
    
    doc.fillColor('#475569')
      .font('Helvetica')
      .fontSize(7)
      .text(`${medicoNome} - ${dataFormatada}`, iconX + 15, seloY + 18);
    
    // ICP-BRASIL integrado no lado direito do selo (compacto)
    const icpX = seloX + seloWidth - 55;
    const icpY = seloY + 8;
    
    doc.fillColor('#e2e8f0')
      .rect(icpX, icpY, 50, 20)
      .fill();
    
    doc.strokeColor('#cbd5e1')
      .lineWidth(0.5)
      .rect(icpX, icpY, 50, 20)
      .stroke();
    
    doc.fillColor('#475569')
      .font('Helvetica-Bold')
      .fontSize(6)
      .text('ICP-BRASIL', icpX + 3, icpY + 3, { align: 'left' });
    
    doc.fillColor('#64748b')
      .font('Helvetica')
      .fontSize(5)
      .text('CERT. DIGITAL', icpX + 3, icpY + 12, { align: 'left' });
    
  } else {
    // Linha para assinatura física - centralizada e compacta
    const linhaWidth = 200; // Reduzida
    const linhaX = centerX - (linhaWidth / 2);
    
    doc.strokeColor(styles.colors.dark)
      .lineWidth(1)
      .moveTo(linhaX, assinaturaY - 35)
      .lineTo(linhaX + linhaWidth, assinaturaY - 35)
      .stroke();
  }
  
  // Nome do médico - centralizado e compacto
  doc.fillColor(styles.colors.dark)
    .font('Helvetica-Bold')
    .fontSize(11) // Reduzido
    .text(medicoNome || 'Médico Responsável', 0, assinaturaY - 25, {
      width: pageWidth,
      align: 'center'
    });
  
  // CRM do médico - centralizado e compacto
  if (usuarioMedico?.crm) {
    doc.fillColor(styles.colors.text)
      .font('Helvetica')
      .fontSize(9) // Reduzido
      .text(`CRM: ${usuarioMedico.crm}`, 0, assinaturaY - 12, {
        width: pageWidth,
        align: 'center'
      });
  }
  
  // Adicionar link público e QR code discretos na parte inferior
  if (doc._publicLinkInfo && doc._publicLinkInfo.shouldAdd && doc._publicLinkInfo.link) {
    const linkPublico = doc._publicLinkInfo.link;
    const bottomY = pageHeight - 35; // Posição na parte inferior da página
    
    try {
      // Gerar QR code pequeno e discreto
      const QRCode = require('qrcode');
      const qrCodeDataURL = await QRCode.toDataURL(linkPublico, {
        width: 40, // Muito pequeno e discreto
        margin: 1,
        color: {
          dark: '#666666',
          light: '#FFFFFF'
        }
      });
      
      // Converter data URL para buffer
      const qrCodeBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');
      
      // Posicionar QR code pequeno no canto direito
      const qrX = pageWidth - 50;
      const qrY = bottomY - 20;
      
      doc.image(qrCodeBuffer, qrX, qrY, { width: 30, height: 30 });
      
      // Link público discreto ao lado do QR code
      doc.fillColor('#888888')
        .font('Helvetica')
        .fontSize(6)
        .text('Acesso público:', styles.margins.left, bottomY - 22)
        .text(linkPublico, styles.margins.left, bottomY - 13, {
          width: pageWidth - 70, // Deixar espaço para o QR code
          link: linkPublico
        });
        
    } catch (qrError) {
      console.error('Erro ao gerar QR Code:', qrError);
      // Se não conseguir gerar QR code, apenas adicionar o link
      doc.fillColor('#888888')
        .font('Helvetica')
        .fontSize(6)
        .text(`Acesso público: ${linkPublico}`, styles.margins.left, bottomY - 10, {
          width: pageWidth - styles.margins.left - styles.margins.right,
          link: linkPublico
        });
    }
  }
  
  return assinaturaY;
}
// Função para gerar PDF assinado - ATUALIZADA PARA USAR CERTIFICADOS DOS MÉDICOS
exports.gerarPdfLaudoAssinado = async (laudoId, exame, tipoExame, medicoNome, medicoId, conclusao, tenantId = 'default', senhaCertificado = null) => {
  try {
    // Obter dados completos e descriptografados
    const laudoCompleto = await obterLaudoPorId(laudoId);
    if (!laudoCompleto) {
      throw new Error('Laudo não encontrado');
    }

    const usuarioMedico = await Usuario.findById(medicoId).populate('crm');

    const pdfBuffers = [];
    const doc = new PDFDocument({ size: 'A4', margin: 30, bufferPages: true });
    doc.on('data', chunk => pdfBuffers.push(chunk));

    // Gerar link público para o laudo
    const publicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/publico/${laudoId}`;

    // Gerar conteúdo do PDF usando dados descriptografados
    const currentY = await gerarConteudoPdfLaudo(
      doc, 
      laudoCompleto, 
      laudoCompleto.exame, 
      usuarioMedico, 
      medicoNome, 
      conclusao, 
      publicLink, 
      defaultStyles
    );

    // Buscar certificado digital do médico para obter informações
    const certificadoService = require('../services/certificadoDigitalService');
    let certificadoInfo = null;
    
    try {
      const certInfo = await certificadoService.obterCertificadoParaAssinatura(medicoId);
      certificadoInfo = certInfo.informacoes;
    } catch (certificadoError) {
      console.warn(`Certificado digital não encontrado para médico ${medicoId}:`, certificadoError.message);
    }

    // Adicionar área de assinatura no final do documento
    await adicionarAreaAssinaturaMedica(doc, medicoNome, usuarioMedico, currentY, true, new Date(), certificadoInfo);

    await new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    const pdfBuffer = Buffer.concat(pdfBuffers);

    // Buscar certificado digital do médico para assinatura
    let certificadoParaAssinatura = null;
    
    try {
      certificadoParaAssinatura = await certificadoService.obterCertificadoParaAssinatura(medicoId);
    } catch (certificadoError) {
      console.warn(`Certificado digital não encontrado para médico ${medicoId}:`, certificadoError.message);
      
      // Se não há certificado do médico, fazer upload sem assinatura para S3
      try {
        const uploadResult = await uploadLaudoToS3(
          pdfBuffer, 
          laudoId, 
          tenantId, 
          'assinado', 
          `laudo_${laudoId}.pdf`
        );
        
        return { 
          success: true, 
          fileUrl: uploadResult.url,
          fileKey: uploadResult.key,
          s3Key: uploadResult.key, // Compatibilidade
          assinadoCom: 'sem_assinatura',
          storage: 's3'
        };
      } catch (s3Error) {
        console.error('Erro no upload para S3, tentando UploadCare:', s3Error);
        
        // Fallback para UploadCare se S3 falhar
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
        return { 
          success: true, 
          fileUrl: uploadcareUrl, 
          assinadoCom: 'sem_assinatura',
          storage: 'uploadcare'
        };
      }
    }

    // Assinar com certificado do médico
    try {
      const { SignPdf } = await import('@signpdf/signpdf');
      const { P12Signer } = await import('@signpdf/signer-p12');
      
      const bufferCertificado = certificadoParaAssinatura.bufferCertificado;
      const senhaOriginal = certificadoParaAssinatura.senha; // Senha original descriptografada
      
      // Testar diferentes variações da senha
      const senhasParaTestar = [
        senhaOriginal,
        senhaOriginal?.trim(),
        senhaOriginal?.toLowerCase(),
        senhaOriginal?.toUpperCase(),
        ''  // senha vazia
      ].filter(Boolean);
      
      const forge = require('node-forge');
      let senhaCorreta = null;
      let signedPdf = null;
      
      for (let i = 0; i < senhasParaTestar.length; i++) {
        try {
          const senhaTest = senhasParaTestar[i];
          
          // Validar senha com node-forge primeiro
          const p12Asn1 = forge.asn1.fromDer(bufferCertificado.toString('binary'));
          const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senhaTest);
          
          // Se a validação passou, tentar assinar o PDF
          const pdfWithPlaceholder = plainAddPlaceholder({
            pdfBuffer,
            reason: 'Assinatura Digital Laudo Médico',
            name: certificadoParaAssinatura.informacoes.medico,
            location: 'Sistema LaudoFy',
          });

          const signer = new P12Signer(bufferCertificado, { passphrase: senhaTest });
          const signPdf = new SignPdf();
          
          signedPdf = await signPdf.sign(pdfWithPlaceholder, signer);
          
          senhaCorreta = senhaTest;
          break; // Sair do loop, encontramos a senha correta
          
        } catch (testError) {
          // Continuar testando próxima variação
        }
      }
      
      if (!senhaCorreta || !signedPdf) {
        throw new Error('Nenhuma variação de senha funcionou para assinatura');
      }

      // Registrar uso do certificado
      const CertificadoDigital = require('../models/CertificadoDigital');
      const certificado = await CertificadoDigital.findById(certificadoParaAssinatura.certificadoId);
      if (certificado) {
        await certificado.registrarUso(true);
      }

      // Upload do PDF assinado para S3
      try {
        const uploadResult = await uploadLaudoToS3(
          signedPdf, 
          laudoId, 
          tenantId, 
          'assinado', 
          `laudo_assinado_${laudoId}.pdf`
        );
        
        return { 
          success: true, 
          fileUrl: uploadResult.url,
          fileKey: uploadResult.key,
          s3Key: uploadResult.key, // Compatibilidade
          assinadoCom: 'certificado_medico',
          certificadoId: certificadoParaAssinatura.certificadoId,
          storage: 's3'
        };
      } catch (s3Error) {
        console.error('Erro no upload para S3, tentando UploadCare:', s3Error);
        
        // Fallback para UploadCare se S3 falhar
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
        return { 
          success: true, 
          fileUrl: uploadcareUrl, 
          assinadoCom: 'certificado_medico',
          certificadoId: certificadoParaAssinatura.certificadoId,
          storage: 'uploadcare'
        };
      }
    } catch (signError) {
      console.error('Error signing PDF');
      
      // Fall back to unsigned PDF if signing fails - upload para S3
      try {
        const uploadResult = await uploadLaudoToS3(
          pdfBuffer, 
          laudoId, 
          tenantId, 
          'assinado', 
          `laudo_${laudoId}.pdf`
        );
        
        return { 
          success: true, 
          fileUrl: uploadResult.url,
          fileKey: uploadResult.key,
          s3Key: uploadResult.key, // Compatibilidade
          signed: false,
          storage: 's3'
        };
      } catch (s3Error) {
        console.error('Erro no upload para S3, tentando UploadCare:', s3Error);
        
        // Fallback para UploadCare
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
        return { 
          success: true, 
          fileUrl: uploadcareUrl, 
          signed: false,
          storage: 'uploadcare'
        };
      }
    }
  } catch (err) {
    console.error('Erro na assinatura digital');
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

    // Verificar se o médico tem certificado digital ativo
    const CertificadoDigital = require('../models/CertificadoDigital');
    const certificadoAtivo = await CertificadoDigital.findOne({
      medicoId: usuarioId,
      ativo: true,
      dataVencimento: { $gt: new Date() }
    });

    // Cria o laudo com status baseado na presença de certificado
    const laudoData = {
      exame: exameId,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao,
      status: 'Laudo pronto para assinatura',
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

    // === GERAR E SALVAR PDF ORIGINAL NO S3 ===
    try {
      // Obter dados completos do laudo para gerar PDF
      const laudoCompleto = await obterLaudoPorId(laudo._id);
      if (!laudoCompleto) {
        throw new Error('Erro ao obter dados do laudo criado');
      }

      // Buscar usuário médico
      const usuarioMedico = await Usuario.findById(usuarioId);

      // Gerar PDF original
      const pdfBuffers = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      
      doc.on('data', chunk => pdfBuffers.push(chunk));

      // Gerar link público para o laudo original
      const publicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/publico/${laudo._id}`;

      // Gerar conteúdo do PDF
      await gerarConteudoPdfLaudo(
        doc, 
        laudoCompleto, 
        laudoCompleto.exame, 
        usuarioMedico, 
        usuarioNome, 
        laudoCompleto.conclusao, 
        publicLink, 
        defaultStyles
      );

      // Adicionar área de assinatura FÍSICA (com linha) para o laudo original
      await adicionarAreaAssinaturaMedica(
        doc, 
        usuarioNome, 
        usuarioMedico, 
        doc.y || 600, 
        false, // NÃO assinado digitalmente - mostra linha para assinatura física
        null,
        null
      );

      // Finalizar documento
      await new Promise((resolve, reject) => {
        doc.on('end', resolve);
        doc.on('error', reject);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(pdfBuffers);

      // Fazer upload do PDF original para S3
      const { uploadLaudoToS3 } = require('../services/laudoStorageService');
      
      try {
        const uploadResult = await uploadLaudoToS3(
          pdfBuffer, 
          laudo._id, 
          tenantId, 
          'original', 
          `laudo_original_${laudo._id}.pdf`
        );
        
        // Salvar chave S3 no laudo
        laudo.laudoOriginalKey = uploadResult.key;
        laudo.laudoOriginal = uploadResult.url; // Manter compatibilidade com UploadCare legado
        
        await laudo.save();
        
        console.log(`PDF original salvo no S3: ${uploadResult.key}`);
        
      } catch (s3Error) {
        console.error('Erro ao fazer upload do PDF original para S3:', s3Error);
        // Continuar sem falhar - o PDF será gerado dinamicamente quando necessário
      }
      
    } catch (pdfError) {
      console.error('Erro ao gerar PDF original:', pdfError);
      // Continuar sem falhar - o PDF será gerado dinamicamente quando necessário
    }

    // Atualizar status do exame
    exame.status = certificadoAtivo ? 'Laudo pronto para assinatura' : 'Laudo realizado';
    exame.laudo = laudo._id;
    await exame.save();

    await AuditLog.create({
      userId: usuarioId,
      action: 'create',
      description: `Novo laudo criado para exame ${exameId} - Status: ${laudo.status}`,
      collectionName: 'laudos',
      documentId: laudo._id,
      before: null,
      after: laudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: exame.paciente._id,
        tipoExame: exame.tipoExame.nome,
        temCertificado: !!certificadoAtivo
      },
      tenant_id: tenantId
    });

    res.status(201).json({
      mensagem: certificadoAtivo ? 'Laudo criado! Você pode assinar automaticamente ou fazer upload do laudo assinado.' : 'Laudo criado! Faça upload do laudo assinado para finalizar.',
      laudo: {
        id: laudo._id,
        exame: exameId,
        status: laudo.status,
        criadoEm: laudo.createdAt,
        valorPago: laudo.valorPago,
        temCertificado: !!certificadoAtivo
      },
      temCertificado: !!certificadoAtivo,
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
      novoLaudo.conclusao,
      tenantId
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
    
    // Verificar se o pacienteId é um ObjectId válido
    if (!mongoose.Types.ObjectId.isValid(pacienteId)) {
      return res.status(400).json({ erro: 'ID do paciente inválido' });
    }

    // Primeiro, buscar todos os exames do paciente
    const examesDoPaciente = await Exame.find({ 
      paciente: pacienteId 
    }).select('_id');
    
    const exameIds = examesDoPaciente.map(exame => exame._id);
    
    if (exameIds.length === 0) {
      return res.json({ 
        success: true, 
        laudos: [], 
        message: 'Nenhum exame encontrado para este paciente' 
      });
    }

    // Buscar laudos dos exames do paciente
    let query = { exame: { $in: exameIds } };
    
    // Aplicar filtro de tenant se não for adminMaster
    if (req.usuario.role !== 'adminMaster') {
      if (Array.isArray(req.tenant_id)) {
        query.tenant_id = { $in: req.tenant_id };
      } else {
        query.tenant_id = req.tenant_id;
      }
    }

    const laudos = await Laudo.find(query)
      .populate({
        path: 'exame',
        populate: [
          {
            path: 'paciente',
            select: 'nome dataNascimento email cpf'
          },
          {
            path: 'tipoExame',
            select: 'nome descricao'
          }
        ]
      })
      .populate('medicoResponsavelId', 'nome crm email especialidades')
      .sort({ createdAt: -1 }); // Ordenar do mais recente para o mais antigo

    // Descriptografar campos necessários
    const laudosProcessados = laudos.map(laudo => {
      const laudoObj = laudo.toObject();
      
      // Aplicar getters para descriptografar
      if (laudoObj.conclusao) {
        try {
          laudoObj.conclusao = decrypt(laudoObj.conclusao);
        } catch (error) {
          console.error('Erro ao descriptografar conclusão:', error);
          laudoObj.conclusao = 'Erro na descriptografia';
        }
      }
      
      if (laudoObj.medicoResponsavel) {
        try {
          laudoObj.medicoResponsavel = decrypt(laudoObj.medicoResponsavel);
        } catch (error) {
          console.error('Erro ao descriptografar médico responsável:', error);
        }
      }

      return laudoObj;
    });
    
    res.json({ 
      success: true, 
      laudos: laudosProcessados,
      total: laudosProcessados.length 
    });
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

    // Build base query
    const baseQuery = {};
    
    // Filtrar por role do usuário
    if (req.usuario.role === 'medico') {
      baseQuery.medicoResponsavelId = req.usuario.id;
    } else if (req.usuario.role !== 'adminMaster') {
      if (Array.isArray(req.tenant_id)) {
        baseQuery.tenant_id = { $in: req.tenant_id };
      } else {
        baseQuery.tenant_id = req.tenant_id;
      }
    }
    
    // Aplicar filtros básicos
    if (req.query.status && req.query.status.trim() !== '') {
      baseQuery.status = req.query.status.trim();
    }
    
    if (req.query.exameId && req.query.exameId.trim() !== '') {
      baseQuery.exame = req.query.exameId.trim();
    }

    // Filtro de datas
    if (req.query.dataInicio || req.query.dataFim) {
      baseQuery.createdAt = {};
      if (req.query.dataInicio && req.query.dataInicio.trim() !== '') {
        baseQuery.createdAt.$gte = new Date(req.query.dataInicio);
      }
      if (req.query.dataFim && req.query.dataFim.trim() !== '') {
        const dataFim = new Date(req.query.dataFim);
        dataFim.setHours(23, 59, 59, 999);
        baseQuery.createdAt.$lte = dataFim;
      }
    }

    // NOVA ABORDAGEM: Buscar primeiro os pacientes pelo nome e depois os laudos
    let laudos, total;

    if (req.query.paciente && req.query.paciente.trim() !== '') {
      const termoPaciente = req.query.paciente.trim();

      // Primeiro, buscar todos os pacientes que correspondem ao filtro
      const Paciente = require('../models/Paciente');
      
      // Como o nome está criptografado, vamos buscar todos os pacientes 
      // e descriptografar no lado da aplicação
      const pacientes = await Paciente.find({}).select('_id nome');
            
      // Filtrar pacientes cujo nome descriptografado contém o termo
      const pacientesMatched = [];
      
      for (const paciente of pacientes) {
        try {
          // Usar o getter que já descriptografa
          const nomeDescriptografado = paciente.nome; // O getter do modelo faz a descriptografia
          
          if (nomeDescriptografado && 
              nomeDescriptografado.toLowerCase().includes(termoPaciente.toLowerCase())) {
            pacientesMatched.push(paciente._id);
          }
        } catch (error) {
          console.error('Erro ao descriptografar nome do paciente');
        }
      }
            
      if (pacientesMatched.length === 0) {
        // Nenhum paciente encontrado, retornar resultado vazio
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
      
      if (exameIds.length === 0) {
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
    }

    // Query com populate    
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
          console.error('Erro ao descriptografar conclusão');
        }
      }

      // Garantir descriptografia do nome do paciente
      if (laudoJson.exame?.paciente?.nome && typeof laudoJson.exame.paciente.nome === 'string' && laudoJson.exame.paciente.nome.includes(':')) {
        try {
          laudoJson.exame.paciente.nome = decrypt(laudoJson.exame.paciente.nome) || laudoJson.exame.paciente.nome;
        } catch (error) {
          console.error('Erro ao descriptografar nome do paciente');
        }
      }

      return laudoJson;
    });

    res.json({
      laudos: laudosFormatted,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
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
    }

    // Médicos só podem ver seus próprios laudos
    if (user.role === 'medico') {
      query.medicoResponsavelId = user.id;
    }

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
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Converter para JSON para aplicar getters
    const laudoJson = laudo.toJSON();

    // Verificar e descriptografar campos sensíveis do laudo
    const fieldsToCheck = ['conclusao', 'medicoResponsavel', 'laudoOriginal', 'laudoAssinado', 'observacoesPagamento'];
    
    fieldsToCheck.forEach(field => {
      if (laudoJson[field] && typeof laudoJson[field] === 'string' && laudoJson[field].includes(':')) {
        try {
          laudoJson[field] = decrypt(laudoJson[field]) || laudoJson[field];
        } catch (error) {
          console.error(`Erro ao descriptografar ${field}`);
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
            console.error(`Erro ao descriptografar paciente.${field}`);
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
          console.error('Erro ao calcular idade');
        }
      }
    }

    // Garantir que os dados do exame estejam descriptografados
    if (laudoJson.exame) {
      const exame = laudoJson.exame;
      
      // Verificar se os campos do exame precisam ser descriptografados
      const exameFields = ['arquivo', 'observacoes', 'status'];
      
      exameFields.forEach(field => {
        if (exame[field] && typeof exame[field] === 'string' && exame[field].includes(':')) {
          try {
            exame[field] = decrypt(exame[field]) || exame[field];
          } catch (error) {
            console.error(`Erro ao descriptografar exame.${field}:`);
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
              console.error(`Erro ao descriptografar historico.${field}:`);
            }
          }
        });
        
        return item;
      });
    }

    res.json(laudoJson);
  } catch (err) {
    console.error('Erro ao obter laudo');
    logger.error('Erro ao obter laudo');
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
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Priorizar S3 se disponível
    if (laudo.laudoOriginalKey) {
      try {
        const signedUrlResult = await getSignedUrlForLaudo(laudo.laudoOriginalKey, 3600);
        
        // Verificar se a operação foi bem-sucedida
        if (!signedUrlResult.success) {
          throw new Error(signedUrlResult.error || 'Erro ao gerar URL assinada');
        }
        
        const signedUrl = signedUrlResult.url;
        
        // Fazer o download do arquivo do S3 e retornar como stream
        const https = require('https');
        const http = require('http');
        const url = require('url');
        
        const parsedUrl = url.parse(signedUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        return new Promise((resolve, reject) => {
          protocol.get(signedUrl, (response) => {
            if (response.statusCode !== 200) {
              return res.status(500).json({ erro: 'Erro ao baixar arquivo do S3' });
            }
            
            // Configurar headers para download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="laudo_original_${laudo._id}.pdf"`);
            res.setHeader('Cache-Control', 'no-cache');
            
            // Pipe do stream do S3 para a resposta
            response.pipe(res);
            
            response.on('end', resolve);
            response.on('error', reject);
          }).on('error', (error) => {
            console.error('Erro ao baixar do S3:', error);
            res.status(500).json({ erro: 'Erro ao baixar arquivo' });
          });
        });
        
      } catch (error) {
        console.error('Erro ao gerar URL pré-assinada para laudo original:', error);
        return res.status(500).json({ erro: 'Erro ao gerar link de download' });
      }
    }

    // Fallback: Se não existe no S3, verificar UploadCare legado
    if (laudo.laudoOriginal) {
      const arquivoUrl = laudo.laudoOriginal;
      if (arquivoUrl.includes('ucarecdn.com') || arquivoUrl.startsWith('http')) {
        try {
          const https = require('https');
          const http = require('http');
          const url = require('url');
          
          const parsedUrl = url.parse(arquivoUrl);
          const protocol = parsedUrl.protocol === 'https:' ? https : http;
          
          return new Promise((resolve, reject) => {
            protocol.get(arquivoUrl, (response) => {
              if (response.statusCode !== 200) {
                return res.status(500).json({ erro: 'Erro ao baixar arquivo do UploadCare' });
              }
              
              // Configurar headers para download
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', `attachment; filename="laudo_original_${laudo._id}.pdf"`);
              res.setHeader('Cache-Control', 'no-cache');
              
              // Pipe do stream do UploadCare para a resposta
              response.pipe(res);
              
              response.on('end', resolve);
              response.on('error', reject);
            }).on('error', (error) => {
              console.error('Erro ao baixar do UploadCare:', error);
              res.status(500).json({ erro: 'Erro ao baixar arquivo' });
            });
          });
        } catch (fetchError) {
          console.warn('Erro no download do UploadCare:', fetchError);
        }
      }
    }

    // Último recurso: Gerar PDF dinamicamente se não existir no S3 nem UploadCare
    console.log('PDF original não encontrado no S3 ou UploadCare, gerando dinamicamente...');      
      // Obter dados completos do laudo
      const laudoCompleto = await obterLaudoPorId(req.params.id);
      if (!laudoCompleto) {
        return res.status(404).json({ erro: 'Dados do laudo não encontrados' });
      }

      // Buscar usuário médico
      const usuarioMedico = await Usuario.findById(laudoCompleto.medicoResponsavelId);
      const medicoNome = usuarioMedico ? usuarioMedico.nome : laudoCompleto.medicoResponsavel;

      // Gerar PDF sem assinatura
      const pdfBuffers = [];
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      
      doc.on('data', chunk => pdfBuffers.push(chunk));

      // Gerar link público para o laudo
      const publicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/publico/${id}`;

      // Gerar conteúdo do PDF
      const currentY = await gerarConteudoPdfLaudo(
        doc, 
        laudoCompleto, 
        laudoCompleto.exame, 
        usuarioMedico, 
        medicoNome, 
        laudoCompleto.conclusao, 
        publicLink, 
        defaultStyles
      );

      // Adicionar área de assinatura FÍSICA (com linha) para o laudo original
      await adicionarAreaAssinaturaMedica(
        doc, 
        medicoNome, 
        usuarioMedico, 
        currentY, 
        false, // NÃO assinado digitalmente - mostra linha para assinatura física
        null,
        null
      );

      // Finalizar documento
      await new Promise((resolve, reject) => {
        doc.on('end', resolve);
        doc.on('error', reject);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(pdfBuffers);

      // Definir headers para download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="laudo_original_${laudo._id}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'no-cache');
      
      return res.send(pdfBuffer);

  } catch (err) {
    console.error('Erro ao fazer download do laudo original:', err);
    res.status(500).json({ erro: 'Erro ao fazer download do laudo original' });
  }
};

// Download do laudo assinado
exports.downloadLaudoAssinado = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Priorizar S3 se disponível
    if (laudo.laudoAssinadoKey) {
      try {
        const signedUrlResult = await getSignedUrlForLaudo(laudo.laudoAssinadoKey, 3600);
        
        // Verificar se a operação foi bem-sucedida
        if (!signedUrlResult.success) {
          throw new Error(signedUrlResult.error || 'Erro ao gerar URL assinada');
        }
        
        const signedUrl = signedUrlResult.url;
        
        // Fazer o download do arquivo do S3 e retornar como stream
        const https = require('https');
        const http = require('http');
        const url = require('url');
        
        const parsedUrl = url.parse(signedUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        return new Promise((resolve, reject) => {
          protocol.get(signedUrl, (response) => {
            if (response.statusCode !== 200) {
              return res.status(500).json({ erro: 'Erro ao baixar arquivo do S3' });
            }
            
            // Configurar headers para download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="laudo_assinado_${laudo._id}.pdf"`);
            res.setHeader('Cache-Control', 'no-cache');
            
            // Pipe do stream do S3 para a resposta
            response.pipe(res);
            
            response.on('end', resolve);
            response.on('error', reject);
          }).on('error', (error) => {
            console.error('Erro ao baixar do S3:', error);
            res.status(500).json({ erro: 'Erro ao baixar arquivo' });
          });
        });
        
      } catch (error) {
        console.error('Erro ao gerar URL pré-assinada para laudo assinado:', error);
        return res.status(500).json({ erro: 'Erro ao gerar link de download' });
      }
    }

    // Verificar se existe arquivo assinado (arquivoPath é o novo campo, laudoAssinado é para compatibilidade)
    const arquivoUrl = laudo.arquivoPath || laudo.laudoAssinado;
    
    if (!arquivoUrl) {
      return res.status(404).json({ erro: 'Arquivo assinado não encontrado' });
    }

    // Se for uma URL externa (UploadCare), fazer download e retornar
    if (arquivoUrl.includes('ucarecdn.com') || arquivoUrl.startsWith('http')) {
      try {
        const https = require('https');
        const http = require('http');
        const url = require('url');
        
        const parsedUrl = url.parse(arquivoUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        return new Promise((resolve, reject) => {
          protocol.get(arquivoUrl, (response) => {
            if (response.statusCode !== 200) {
              return res.status(500).json({ erro: 'Erro ao baixar arquivo do UploadCare' });
            }
            
            // Configurar headers para download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="laudo_assinado_${laudo._id}.pdf"`);
            res.setHeader('Cache-Control', 'no-cache');
            
            // Pipe do stream do UploadCare para a resposta
            response.pipe(res);
            
            response.on('end', resolve);
            response.on('error', reject);
          }).on('error', (error) => {
            console.error('Erro ao baixar do UploadCare:', error);
            res.status(500).json({ erro: 'Erro ao baixar arquivo' });
          });
        });
      } catch (fetchError) {
        console.warn('Erro no download do UploadCare:', fetchError);
        res.status(500).json({ erro: 'Erro ao fazer download do arquivo' });
      }
    } else {
      // Se for um arquivo local (para compatibilidade com versões antigas)
      res.status(501).json({ erro: 'Download de arquivos locais não implementado' });
    }
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
    const { id } = req.params;
    
    const laudoCompleto = await obterLaudoPorId(id);
    if (!laudoCompleto) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Retornar dados formatados para visualização pública
    const laudoPublico = {
      id: laudoCompleto._id,
      codigoValidacao: laudoCompleto._id.toString().slice(-8).toUpperCase(),
      versao: laudoCompleto.versao,
      status: laudoCompleto.status === 'Laudo assinado' ? 'ativo' : 'inativo',
      dataEmissao: laudoCompleto.createdAt,
      temPdfAssinado: !!laudoCompleto.laudoAssinado || !!laudoCompleto.laudoAssinadoKey,
      // Informações sobre o tipo de assinatura
      assinadoDigitalmente: laudoCompleto.assinadoDigitalmente || false,
      assinadoCom: laudoCompleto.assinadoCom || 'sem_assinatura',
      dataAssinatura: laudoCompleto.dataAssinatura,
      paciente: {
        nome: laudoCompleto.exame?.paciente?.nome || 'Não informado',
        idade: laudoCompleto.exame?.paciente?.dataNascimento ? 
          calcularIdade(laudoCompleto.exame.paciente.dataNascimento) : null,
        dataNascimento: laudoCompleto.exame?.paciente?.dataNascimento
      },
      exame: {
        tipo: laudoCompleto.exame?.tipoExame?.nome || 'Não informado',
        data: laudoCompleto.exame?.dataExame
      },
      conclusao: laudoCompleto.conclusao,
      medico: laudoCompleto.medicoResponsavel || 'Médico não informado'
    };

    res.json(laudoPublico);
  } catch (err) {
    logger.error('Erro ao visualizar laudo público:', err);
    res.status(500).json({ erro: 'Erro ao visualizar laudo público' });
  }
};

// Gerar PDF público do laudo
exports.gerarPdfLaudoPublico = async (req, res) => {
  try {
    const { id } = req.params;
    
    const laudoCompleto = await obterLaudoPorId(id);
    if (!laudoCompleto) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Verificar se laudo tem PDF assinado
    if (laudoCompleto.laudoAssinadoKey || laudoCompleto.laudoAssinado) {
      // Se tem S3 key, buscar do S3
      if (laudoCompleto.laudoAssinadoKey) {
        const { getSignedUrlForLaudo } = require('../services/laudoStorageService');
        try {
          const signedUrl = await getSignedUrlForLaudo(laudoCompleto.laudoAssinadoKey);
          return res.redirect(signedUrl);
        } catch (error) {
          console.error('Erro ao obter URL assinada do S3:', error);
        }
      }
      
      // Fallback para URL do UploadCare (legado)
      if (laudoCompleto.laudoAssinado) {
        return res.redirect(laudoCompleto.laudoAssinado);
      }
    }

    // Se não tem PDF assinado, gerar PDF dinâmico com link público e QR code
    const PDFDocument = require('pdfkit');
    const QRCode = require('qrcode');
    
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 40, right: 40 }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="laudo_${laudoCompleto._id}.pdf"`);
    
    doc.pipe(res);

    const pdfBuffers = [];
    doc.on('data', chunk => pdfBuffers.push(chunk));

    // Gerar link público
    const publicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/publico/${id}`;
    
    // Gerar QR Code
    let qrCodeDataUrl;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(publicLink, {
        width: 150,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (qrError) {
      console.error('Erro ao gerar QR Code:', qrError);
    }

    // Gerar conteúdo do PDF
    const usuarioMedico = await Usuario.findById(laudoCompleto.medicoResponsavelId);
    
    await gerarConteudoPdfLaudo(
      doc, 
      laudoCompleto, 
      laudoCompleto.exame, 
      usuarioMedico, 
      laudoCompleto.medicoResponsavel, 
      laudoCompleto.conclusao, 
      publicLink, 
      defaultStyles
    );

    // Adicionar área de assinatura física (o link público será adicionado discretamente pela função)
    const currentY = doc.y + 20; // Reduzido o espaçamento
    await adicionarAreaAssinaturaMedica(
      doc, 
      laudoCompleto.medicoResponsavel, 
      usuarioMedico, 
      currentY, 
      false, // Não assinado digitalmente - mostra linha para assinatura física
      null,
      null
    );

    doc.end();

  } catch (err) {
    logger.error('Erro ao gerar PDF público:', err);
    res.status(500).json({ erro: 'Erro ao gerar PDF público' });
  }
};

// Autenticar laudo público (removido - não é mais necessário)
exports.autenticarLaudoPublico = async (req, res) => {
  try {
    res.status(410).json({ erro: 'Autenticação não é mais necessária. O laudo é público.' });
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

// Gerar relatório
exports.gerarRelatorio = async (req, res) => {
  try {
    const { medicoId, tipoExame, status, dataInicio, dataFim } = req.query;
    
    // Construir query base
    const query = {};
    
    // Filtrar por tenant
    if (req.usuario.role !== 'adminMaster') {
      if (Array.isArray(req.tenant_id)) {
        query.tenant_id = { $in: req.tenant_id };
      } else {
        query.tenant_id = req.tenant_id;
      }
    }
    
    // Médicos só veem seus próprios laudos
    if (req.usuario.role === 'medico') {
      query.medicoResponsavelId = req.usuario.id;
    } else if (medicoId && medicoId.trim() !== '') {
      query.medicoResponsavelId = medicoId;
    }
    
    // Filtros adicionais
    if (status && status.trim() !== '') {
      query.status = status;
    }
    
    if (dataInicio || dataFim) {
      query.createdAt = {};
      if (dataInicio) {
        query.createdAt.$gte = new Date(dataInicio);
      }
      if (dataFim) {
        const dataFimAjustada = new Date(dataFim);
        dataFimAjustada.setHours(23, 59, 59, 999);
        query.createdAt.$lte = dataFimAjustada;
      }
    }
    
    // Buscar laudos com populate
    const laudos = await Laudo.find(query)
      .populate({
        path: 'exame',
        populate: [
          {
            path: 'paciente',
            select: 'nome dataNascimento email cpf'
          },
          {
            path: 'tipoExame',
            select: 'nome descricao'
          }
        ]
      })
      .populate('medicoResponsavelId', 'nome crm email especialidades')
      .sort({ createdAt: -1 })
      .lean();
    
    // Aplicar filtro de tipo de exame após o populate
    let laudosFiltrados = laudos;
    if (tipoExame && tipoExame.trim() !== '') {
      laudosFiltrados = laudos.filter(laudo => 
        laudo.exame?.tipoExame?.nome === tipoExame
      );
    }
    
    // Descriptografar dados sensíveis
    const laudosProcessados = laudosFiltrados.map(laudo => {
      try {
        // Descriptografar campos do laudo
        if (laudo.conclusao && typeof laudo.conclusao === 'string' && laudo.conclusao.includes(':')) {
          laudo.conclusao = decrypt(laudo.conclusao);
        }
        if (laudo.medicoResponsavel && typeof laudo.medicoResponsavel === 'string' && laudo.medicoResponsavel.includes(':')) {
          laudo.medicoResponsavel = decrypt(laudo.medicoResponsavel);
        }
        
        // Descriptografar dados do paciente
        if (laudo.exame?.paciente) {
          const paciente = laudo.exame.paciente;
          ['nome', 'email', 'cpf'].forEach(field => {
            if (paciente[field] && typeof paciente[field] === 'string' && paciente[field].includes(':')) {
              paciente[field] = decrypt(paciente[field]);
            }
          });
        }
      } catch (err) {
        console.error('Erro ao descriptografar dados do laudo:', err);
      }
      
      return laudo;
    });
    
    // Calcular totais
    const totais = {
      quantidade: laudosProcessados.length,
      assinados: laudosProcessados.filter(l => l.status === 'Laudo assinado').length,
      pendentes: laudosProcessados.filter(l => l.status !== 'Laudo assinado').length,
      realizados: laudosProcessados.filter(l => l.status === 'Laudo realizado').length,
      cancelados: laudosProcessados.filter(l => l.status === 'Cancelado').length
    };
    
    // Estatísticas por médico
    const estatisticasPorMedico = {};
    laudosProcessados.forEach(laudo => {
      const medico = laudo.medicoResponsavelId?.nome || laudo.medicoResponsavel || 'Não informado';
      if (!estatisticasPorMedico[medico]) {
        estatisticasPorMedico[medico] = {
          total: 0,
          assinados: 0,
          pendentes: 0
        };
      }
      estatisticasPorMedico[medico].total++;
      if (laudo.status === 'Laudo assinado') {
        estatisticasPorMedico[medico].assinados++;
      } else {
        estatisticasPorMedico[medico].pendentes++;
      }
    });
    
    // Estatísticas por tipo de exame
    const estatisticasPorTipo = {};
    laudosProcessados.forEach(laudo => {
      const tipo = laudo.exame?.tipoExame?.nome || 'Não informado';
      if (!estatisticasPorTipo[tipo]) {
        estatisticasPorTipo[tipo] = 0;
      }
      estatisticasPorTipo[tipo]++;
    });
    
    res.json({
      success: true,
      data: {
        laudos: laudosProcessados,
        totais,
        estatisticasPorMedico,
        estatisticasPorTipo,
        filtros: {
          medicoId,
          tipoExame,
          status,
          dataInicio,
          dataFim
        }
      }
    });
    
  } catch (err) {
    logger.error('Erro ao gerar relatório:', err);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao gerar relatório',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Exportar relatório em PDF
exports.relatorioPdf = async (req, res) => {
  try {
    const { medicoId, tipoExame, status, dataInicio, dataFim } = req.query;
    
    // Reutilizar a lógica do gerarRelatorio para obter os dados
    const query = {};
    
    // Filtrar por tenant
    if (req.usuario.role !== 'adminMaster') {
      if (Array.isArray(req.tenant_id)) {
        query.tenant_id = { $in: req.tenant_id };
      } else {
        query.tenant_id = req.tenant_id;
      }
    }
    
    // Médicos só veem seus próprios laudos
    if (req.usuario.role === 'medico') {
      query.medicoResponsavelId = req.usuario.id;
    } else if (medicoId && medicoId.trim() !== '') {
      query.medicoResponsavelId = medicoId;
    }
    
    if (status && status.trim() !== '') {
      query.status = status;
    }
    
    if (dataInicio || dataFim) {
      query.createdAt = {};
      if (dataInicio) {
        query.createdAt.$gte = new Date(dataInicio);
      }
      if (dataFim) {
        const dataFimAjustada = new Date(dataFim);
        dataFimAjustada.setHours(23, 59, 59, 999);
        query.createdAt.$lte = dataFimAjustada;
      }
    }
    
    const laudos = await Laudo.find(query)
      .populate({
        path: 'exame',
        populate: [
          {
            path: 'paciente',
            select: 'nome dataNascimento email cpf'
          },
          {
            path: 'tipoExame',
            select: 'nome descricao'
          }
        ]
      })
      .populate('medicoResponsavelId', 'nome crm email especialidades')
      .sort({ createdAt: -1 })
      .lean();
    
    // Aplicar filtro de tipo de exame
    let laudosFiltrados = laudos;
    if (tipoExame && tipoExame.trim() !== '') {
      laudosFiltrados = laudos.filter(laudo => 
        laudo.exame?.tipoExame?.nome === tipoExame
      );
    }
    
    // Criar o PDF
    const doc = new PDFDocument();
    const filename = `relatorio_laudos_${new Date().toISOString().split('T')[0]}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    doc.pipe(res);
    
    // Cabeçalho do relatório
    doc.fontSize(18).text('Relatório de Laudos', 50, 50);
    doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 50, 80);
    
    // Filtros aplicados
    let filtrosTexto = 'Filtros aplicados: ';
    if (dataInicio) filtrosTexto += `Data início: ${new Date(dataInicio).toLocaleDateString('pt-BR')} `;
    if (dataFim) filtrosTexto += `Data fim: ${new Date(dataFim).toLocaleDateString('pt-BR')} `;
    if (status) filtrosTexto += `Status: ${status} `;
    if (tipoExame) filtrosTexto += `Tipo de exame: ${tipoExame}`;
    
    doc.fontSize(10).text(filtrosTexto, 50, 110);
    
    // Estatísticas
    const totais = {
      quantidade: laudosFiltrados.length,
      assinados: laudosFiltrados.filter(l => l.status === 'Laudo assinado').length,
      pendentes: laudosFiltrados.filter(l => l.status !== 'Laudo assinado').length
    };
    
    let yPosition = 140;
    doc.fontSize(14).text('Resumo:', 50, yPosition);
    yPosition += 25;
    doc.fontSize(11)
      .text(`Total de laudos: ${totais.quantidade}`, 50, yPosition)
      .text(`Laudos assinados: ${totais.assinados}`, 50, yPosition + 15)
      .text(`Laudos pendentes: ${totais.pendentes}`, 50, yPosition + 30);
    
    yPosition += 60;
    
    // Lista de laudos
    doc.fontSize(14).text('Detalhes dos Laudos:', 50, yPosition);
    yPosition += 25;
    
    laudosFiltrados.forEach((laudo, index) => {
      // Verificar se precisa de nova página
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }
      
      try {
        // Descriptografar dados se necessário
        let pacienteNome = 'Não informado';
        if (laudo.exame?.paciente?.nome) {
          pacienteNome = laudo.exame.paciente.nome;
          if (typeof pacienteNome === 'string' && pacienteNome.includes(':')) {
            pacienteNome = decrypt(pacienteNome);
          }
        }
        
        let medicoNome = 'Não informado';
        if (laudo.medicoResponsavelId?.nome) {
          medicoNome = laudo.medicoResponsavelId.nome;
        } else if (laudo.medicoResponsavel) {
          medicoNome = laudo.medicoResponsavel;
          if (typeof medicoNome === 'string' && medicoNome.includes(':')) {
            medicoNome = decrypt(medicoNome);
          }
        }
        
        doc.fontSize(10)
          .text(`${index + 1}. ${pacienteNome} - ${laudo.exame?.tipoExame?.nome || 'N/A'} - ${laudo.status}`, 50, yPosition)
          .text(`   Médico: ${medicoNome}`, 70, yPosition + 12)
          .text(`   Data: ${new Date(laudo.createdAt).toLocaleDateString('pt-BR')}`, 70, yPosition + 24);
        
        yPosition += 45;
      } catch (err) {
        console.error('Erro ao processar laudo no PDF:', err);
        doc.fontSize(10).text(`${index + 1}. Erro ao processar dados do laudo`, 50, yPosition);
        yPosition += 20;
      }
    });
    
    doc.end();
    
  } catch (err) {
    logger.error('Erro ao exportar relatório PDF:', err);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao exportar relatório PDF',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
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
    console.error('Error retrieving report statistics');
    res.status(500).json({
      message: 'Error retrieving report statistics',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Função para assinar laudo com validação de senha do certificado
exports.assinarLaudoComCertificado = async (laudoId, medicoId, senhaCertificado) => {
  try {
    const certificadoService = require('../services/certificadoDigitalService');
    const CertificadoDigital = require('../models/CertificadoDigital');
    
    // Obter certificado ativo do médico
    const certificadoInfo = await certificadoService.obterCertificadoParaAssinatura(medicoId);
    
    // Buscar o certificado no banco para validar a senha fornecida (se fornecida)
    const certificado = await CertificadoDigital.findById(certificadoInfo.certificadoId);
    
    if (!certificado) {
      throw new Error('Certificado não encontrado');
    }
    
    // Validar senha fornecida se foi fornecida (para confirmação do usuário)
    if (senhaCertificado && !(await certificado.validarSenha(senhaCertificado))) {
      await certificado.registrarUso(false, null, 'Senha incorreta durante assinatura');
      throw new Error('Senha do certificado incorreta');
    }
    
    // Obter dados do laudo descriptografados
    const laudoCompleto = await obterLaudoPorId(laudoId);
    if (!laudoCompleto) {
      throw new Error('Laudo não encontrado');
    }
    
    const usuarioMedico = await Usuario.findById(medicoId);
    const medicoNome = usuarioMedico.nome;
    
    // Gerar PDF
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

    // Gerar link público para o laudo
    const publicLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/publico/${laudoId}`;

    // Gerar conteúdo do PDF usando dados descriptografados
    await gerarConteudoPdfLaudo(doc, laudoCompleto, laudoCompleto.exame, usuarioMedico, medicoNome, laudoCompleto.conclusao, publicLink, defaultStyles);

    await new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    const pdfBuffer = Buffer.concat(pdfBuffers);
    
    // Assinar com certificado do médico
    const { SignPdf } = await import('@signpdf/signpdf');
    const { P12Signer } = await import('@signpdf/signer-p12');
    
    const bufferCertificado = certificadoInfo.bufferCertificado;
    const senhaOriginal = certificadoInfo.senha; // Usa a senha original armazenada do certificado
    
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer,
      reason: 'Assinatura Digital Laudo Médico',
      name: certificadoInfo.informacoes.medico,
      location: 'Sistema LaudoFy',
    });

    // Criar o signer P12 e o SignPdf
    const signer = new P12Signer(bufferCertificado, { passphrase: senhaOriginal });
    const signPdf = new SignPdf();
    
    const signedPdf = await signPdf.sign(pdfWithPlaceholder, signer);

    // Registrar uso bem-sucedido do certificado
    await certificado.registrarUso(true);

    // Upload do PDF assinado
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
    
    // Atualizar laudo
    laudo.laudoAssinado = uploadcareUrl;
    laudo.dataAssinatura = new Date();
    laudo.status = 'Laudo assinado';
    await laudo.save();
    
    // Atualizar status do exame também
    const exameAtualizar = await Exame.findById(laudo.exame._id || laudo.exame);
    if (exameAtualizar) {
      exameAtualizar.status = 'Laudo realizado';
      await exameAtualizar.save();
    }
    
    return { 
      success: true, 
      fileUrl: uploadcareUrl, 
      assinadoCom: 'certificado_medico',
      certificadoId: certificadoInfo.certificadoId,
      certificadoNome: certificado.nomeCertificado
    };
    
  } catch (error) {
    console.error('Erro ao assinar laudo com certificado');
    throw error;
  }
};

// === NOVOS MÉTODOS PARA ASSINATURA FLEXÍVEL ===

// Assinar laudo automaticamente (quando médico confirma no modal)
exports.assinarLaudoAutomaticamente = async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;
    const usuarioNome = req.usuario.nome;

    // Buscar o laudo
    const laudo = await Laudo.findById(id)
      .populate({
        path: 'exame',
        populate: [
          { path: 'paciente', select: 'nome cpf' },
          { path: 'tipoExame', select: 'nome' }
        ]
      });

    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Verificar se o médico é o responsável pelo laudo
    if (laudo.medicoResponsavelId.toString() !== usuarioId) {
      return res.status(403).json({ erro: 'Você não tem permissão para assinar este laudo' });
    }

    // Verificar se o laudo pode ser assinado
    if (!['Laudo pronto para assinatura', 'Laudo realizado'].includes(laudo.status)) {
      return res.status(400).json({ erro: 'Este laudo não pode ser assinado automaticamente' });
    }

    // Verificar se o médico tem certificado ativo
    const CertificadoDigital = require('../models/CertificadoDigital');
    const certificadoAtivo = await CertificadoDigital.findOne({
      medicoId: usuarioId,
      ativo: true,
      dataVencimento: { $gt: new Date() }
    });

    if (!certificadoAtivo) {
      return res.status(400).json({ 
        erro: 'Você não possui um certificado digital ativo. Cadastre um certificado ou faça upload do laudo assinado.' 
      });
    }

    // Gerar PDF assinado automaticamente
    const resultadoPdf = await exports.gerarPdfLaudoAssinado(
      laudo._id,
      laudo.exame,
      laudo.exame.tipoExame,
      usuarioNome,
      usuarioId,
      laudo.conclusao,
      laudo.tenant_id
    );

    if (!resultadoPdf.success) {
      return res.status(500).json({ erro: 'Erro ao gerar PDF assinado' });
    }

    // Salvar chave S3 do laudo assinado se disponível
    if (resultadoPdf.s3Key) {
      laudo.laudoAssinadoKey = resultadoPdf.s3Key;
    }

    // Implementar exclusão automática do laudo original após assinatura
    if (laudo.laudoOriginalKey) {
      try {
        // Excluir laudo original do S3
        await deleteLaudoFromS3(laudo.laudoOriginalKey);
        logger.info(`Laudo original excluído do S3: ${laudo.laudoOriginalKey}`);
        
        // Limpar a chave do laudo original
        laudo.laudoOriginalKey = null;
      } catch (deleteError) {
        logger.error('Erro ao excluir laudo original do S3:', deleteError);
        // Continuar mesmo se houver erro na exclusão
      }
    }

    // Atualizar laudo
    laudo.arquivoPath = resultadoPdf.fileUrl;
    laudo.assinadoDigitalmente = true;
    laudo.assinadoCom = resultadoPdf.assinadoCom;
    laudo.certificadoId = resultadoPdf.certificadoId;
    laudo.status = 'Laudo assinado';
    laudo.dataAssinatura = new Date();
    
    // Adicionar ao histórico
    laudo.historico.push({
      usuario: usuarioId,
      nomeUsuario: usuarioNome,
      acao: 'Assinatura',
      detalhes: 'Laudo assinado automaticamente com certificado digital',
      versao: laudo.versao
    });

    await laudo.save();

    // Atualizar status do exame
    const exame = await Exame.findById(laudo.exame._id || laudo.exame);
    if (exame) {
      exame.status = 'Laudo realizado';
      await exame.save();
    }

    res.json({
      mensagem: 'Laudo assinado automaticamente com sucesso!',
      laudo: {
        id: laudo._id,
        status: laudo.status,
        arquivoPath: laudo.arquivoPath,
        dataAssinatura: laudo.dataAssinatura
      }
    });

  } catch (error) {
    console.error('Erro ao assinar laudo automaticamente:');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Assinar laudo manualmente (botão na página de detalhes)
exports.assinarLaudoManual = async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;
    const usuarioNome = req.usuario.nome;

    // Buscar o laudo
    const laudo = await Laudo.findById(id)
      .populate({
        path: 'exame',
        populate: [
          { path: 'paciente', select: 'nome cpf' },
          { path: 'tipoExame', select: 'nome' }
        ]
      });

    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Verificar se o médico é o responsável pelo laudo
    if (laudo.medicoResponsavelId.toString() !== usuarioId) {
      return res.status(403).json({ erro: 'Você não tem permissão para assinar este laudo' });
    }

    // Verificar se o laudo pode ser assinado
    if (!['Laudo pronto para assinatura', 'Laudo realizado'].includes(laudo.status)) {
      return res.status(400).json({ erro: 'Este laudo não pode ser assinado' });
    }

    // Verificar se já não está assinado
    if (laudo.status === 'Laudo assinado') {
      return res.status(400).json({ erro: 'Este laudo já está assinado' });
    }

    // Verificar se o médico tem certificado ativo
    const CertificadoDigital = require('../models/CertificadoDigital');
    const certificadoAtivo = await CertificadoDigital.findOne({
      medicoId: usuarioId,
      ativo: true,
      dataVencimento: { $gt: new Date() }
    });

    if (!certificadoAtivo) {
      return res.status(400).json({ 
        erro: 'Você não possui um certificado digital ativo. Cadastre um certificado primeiro.' 
      });
    }

    // Gerar PDF assinado
    const resultadoPdf = await exports.gerarPdfLaudoAssinado(
      laudo._id,
      laudo.exame,
      laudo.exame.tipoExame,
      usuarioNome,
      usuarioId,
      laudo.conclusao,
      req.usuario.tenant_id
    );

    if (!resultadoPdf.success) {
      return res.status(500).json({ erro: 'Erro ao gerar PDF assinado' });
    }

    // Atualizar laudo
    laudo.arquivoPath = resultadoPdf.fileUrl;
    laudo.assinadoDigitalmente = true;
    laudo.assinadoCom = resultadoPdf.assinadoCom;
    laudo.certificadoId = resultadoPdf.certificadoId;
    laudo.status = 'Laudo assinado';
    laudo.dataAssinatura = new Date();
    
    // Adicionar ao histórico
    laudo.historico.push({
      usuario: usuarioId,
      nomeUsuario: usuarioNome,
      acao: 'Assinatura',
      detalhes: 'Laudo assinado manualmente com certificado digital',
      versao: laudo.versao
    });

    await laudo.save();

    // Atualizar status do exame
    const exame = await Exame.findById(laudo.exame._id || laudo.exame);
    if (exame) {
      exame.status = 'Laudo realizado';
      await exame.save();
    }

    res.json({
      mensagem: 'Laudo assinado com sucesso!',
      laudo: {
        id: laudo._id,
        status: laudo.status,
        arquivoPath: laudo.arquivoPath,
        dataAssinatura: laudo.dataAssinatura
      }
    });

  } catch (error) {
    console.error('Erro ao assinar laudo manualmente:');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Upload de laudo assinado pelo médico
exports.uploadLaudoAssinado = async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioId = req.usuario.id;
    const usuarioNome = req.usuario.nome;

    if (!req.file) {
      return res.status(400).json({ erro: 'Arquivo PDF é obrigatório' });
    }

    // Verificar se é um PDF
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ erro: 'Apenas arquivos PDF são aceitos' });
    }

    // Buscar o laudo
    const laudo = await Laudo.findById(id);
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Verificar se o médico é o responsável pelo laudo
    if (laudo.medicoResponsavelId.toString() !== usuarioId) {
      return res.status(403).json({ erro: 'Você não tem permissão para fazer upload neste laudo' });
    }

    // Verificar se o laudo pode receber upload
    if (!['Laudo pronto para assinatura', 'Laudo realizado'].includes(laudo.status)) {
      return res.status(400).json({ erro: 'Este laudo não pode receber upload' });
    }

    // Upload para S3 primeiro, com fallback para UploadCare
    let uploadUrl;
    let s3Key = null;
    
    try {
      // Tentar upload para S3 primeiro
      const s3Result = await uploadLaudoStreamToS3(
        req.file.buffer,
        `laudo_assinado_${id}.pdf`,
        'application/pdf'
      );
      
      if (s3Result.success) {
        uploadUrl = s3Result.url;
        s3Key = s3Result.key;
        logger.info(`Laudo assinado enviado para S3: ${s3Key}`);
      } else {
        throw new Error('Falha no upload S3');
      }
    } catch (s3Error) {
      logger.error('Erro no upload S3, usando UploadCare como fallback:', s3Error);
      
      // Fallback para UploadCare
      const { uploadPDFToUploadcare } = require('../services/uploadcareService');
      
      const pdfFile = {
        buffer: req.file.buffer,
        originalname: `laudo_assinado_${id}.pdf`,
        mimetype: 'application/pdf',
        size: req.file.size,
        stream: () => {
          const stream = new require('stream').Readable();
          stream.push(req.file.buffer);
          stream.push(null);
          return stream;
        }
      };

      uploadUrl = await uploadPDFToUploadcare(pdfFile);
    }

    // Salvar chave S3 do laudo assinado se disponível
    if (s3Key) {
      laudo.laudoAssinadoKey = s3Key;
    }

    // Implementar exclusão automática do laudo original após assinatura
    if (laudo.laudoOriginalKey) {
      try {
        // Excluir laudo original do S3
        await deleteLaudoFromS3(laudo.laudoOriginalKey);
        logger.info(`Laudo original excluído do S3: ${laudo.laudoOriginalKey}`);
        
        // Limpar a chave do laudo original
        laudo.laudoOriginalKey = null;
      } catch (deleteError) {
        logger.error('Erro ao excluir laudo original do S3:', deleteError);
        // Continuar mesmo se houver erro na exclusão
      }
    }

    // Atualizar laudo
    laudo.arquivoPath = uploadUrl;
    laudo.assinadoDigitalmente = false; // Não é assinatura digital automática
    laudo.assinadoCom = 'upload_manual';
    laudo.status = 'Laudo assinado';
    laudo.dataAssinatura = new Date();
    
    // Adicionar ao histórico
    laudo.historico.push({
      usuario: usuarioId,
      nomeUsuario: usuarioNome,
      acao: 'Assinatura',
      detalhes: 'Laudo assinado via upload manual',
      versao: laudo.versao
    });

    await laudo.save();

    // Atualizar status do exame
    const Exame = require('../models/Exame');
    const exame = await Exame.findById(laudo.exame);
    if (exame) {
      exame.status = 'Laudo realizado';
      await exame.save();
    }

    // Log de auditoria
    try {
      await AuditLog.create({
        userId: usuarioId,
        action: 'update',
        description: `Upload manual de laudo assinado - ${req.file.originalname}`,
        collectionName: 'laudos',
        documentId: laudo._id,
        before: { status: 'Laudo pronto para assinatura' },
        after: { 
          status: 'Laudo assinado',
          arquivoPath: uploadUrl,
          assinadoCom: 'upload_manual',
          laudoAssinadoKey: s3Key
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.usuario.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria:');
    }

    res.json({
      mensagem: 'Laudo assinado enviado com sucesso!',
      laudo: {
        id: laudo._id,
        status: laudo.status,
        arquivoPath: laudo.arquivoPath,
        dataAssinatura: laudo.dataAssinatura,
        assinadoDigitalmente: false,
        assinadoCom: 'upload_manual'
      },
      notificacao: {
        status: 'upload_concluido',
        tipo: 'upload_manual'
      }
    });

  } catch (error) {
    console.error('Erro ao fazer upload do laudo assinado:');
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};