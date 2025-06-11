const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const CertificadoDigitalSchema = new mongoose.Schema({
  medicoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true,
    index: true
  },
  
  // Informações do certificado
  nomeCertificado: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  // Dados técnicos do certificado
  numeroSerie: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  emissor: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  // Datas de validade
  dataEmissao: {
    type: Date,
    required: true
  },
  
  dataVencimento: {
    type: Date,
    required: true,
    index: true
  },
  
  // Arquivo do certificado (criptografado)
  arquivoCertificado: {
    type: String, // URL segura ou caminho criptografado
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  // Senha do certificado (criptografada)
  senhaCertificado: {
    type: String,
    required: true,
    set: function(v) {
      if (!v) return v;
      // Criptografar a senha original para uso na assinatura
      return encrypt(v.trim());
    },
    get: function(v) {
      if (!v) return v;
      try {
        return decrypt(v); // Retorna a senha original descriptografada
      } catch (error) {
        console.error('Erro ao descriptografar senha do certificado');
        return null;
      }
    }
  },

  // Hash da senha para validação (sem exposição da senha original)
  senhaHash: {
    type: String,
    required: true
  },
  
  // Informações de uso
  ultimoUso: {
    type: Date,
    default: null
  },
  
  totalAssinaturas: {
    type: Number,
    default: 0
  },
  
  // Status e configurações
  ativo: {
    type: Boolean,
    default: true,
    index: true
  },
  
  validado: {
    type: Boolean,
    default: false
  },
  
  // Metadados de segurança
  fingerprint: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  algoritmoAssinatura: {
    type: String,
    default: 'SHA256withRSA'
  },
  
  tamanhoChave: {
    type: Number,
    default: 2048
  },
  
  // Auditoria
  criadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  
  ipCriacao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  userAgentCriacao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  
  // Log de tentativas de uso
  tentativasUso: [{
    data: {
      type: Date,
      default: Date.now
    },
    sucesso: Boolean,
    ip: {
      type: String,
      set: v => v ? encrypt(v.trim()) : v,
      get: v => v ? decrypt(v) : v
    },
    erro: {
      type: String,
      set: v => v ? encrypt(v.trim()) : v,
      get: v => v ? decrypt(v) : v
    }
  }]
}, {
  timestamps: true,
  toJSON: { 
    getters: true,
    transform: function(doc, ret) {
      // Remove campos sensíveis do JSON
      delete ret.senhaCertificado;
      delete ret.senhaHash;
      delete ret.arquivoCertificado;
      delete ret.tentativasUso;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { getters: true }
});

// Índices compostos para performance
CertificadoDigitalSchema.index({ medicoId: 1, ativo: 1 });
CertificadoDigitalSchema.index({ dataVencimento: 1, ativo: 1 });
CertificadoDigitalSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });

// Middleware para validação de data
CertificadoDigitalSchema.pre('save', function(next) {
  if (this.dataVencimento <= this.dataEmissao) {
    return next(new Error('Data de vencimento deve ser posterior à data de emissão'));
  }
  
  if (this.dataVencimento <= new Date()) {
    this.ativo = false;
  }
  
  next();
});

// Método para validar senha
CertificadoDigitalSchema.methods.validarSenha = async function(senhaFornecida) {
  try {
    const bcrypt = require('bcryptjs');
    return await bcrypt.compare(senhaFornecida, this.senhaHash);
  } catch (error) {
    console.error('Erro ao validar senha do certificado:', error);
    return false;
  }
};

// Método para registrar uso
CertificadoDigitalSchema.methods.registrarUso = async function(sucesso = true, ip = null, erro = null) {
  this.ultimoUso = new Date();
  
  if (sucesso) {
    this.totalAssinaturas += 1;
  }
  
  this.tentativasUso.push({
    sucesso,
    ip,
    erro
  });
  
  // Manter apenas os últimos 50 registros de tentativas
  if (this.tentativasUso.length > 50) {
    this.tentativasUso = this.tentativasUso.slice(-50);
  }
  
  await this.save();
};

// Método para verificar se está próximo do vencimento
CertificadoDigitalSchema.methods.proximoVencimento = function(diasAviso = 30) {
  const agora = new Date();
  const diasParaVencimento = Math.ceil((this.dataVencimento - agora) / (1000 * 60 * 60 * 24));
  return diasParaVencimento <= diasAviso && diasParaVencimento > 0;
};

// Método para verificar se está vencido
CertificadoDigitalSchema.methods.estaVencido = function() {
  return this.dataVencimento <= new Date();
};

// Virtual para status do certificado
CertificadoDigitalSchema.virtual('status').get(function() {
  if (!this.ativo) return 'inativo';
  if (this.estaVencido()) return 'vencido';
  if (this.proximoVencimento()) return 'proximo_vencimento';
  if (!this.validado) return 'pendente_validacao';
  return 'ativo';
});

// Virtual para dias até vencimento
CertificadoDigitalSchema.virtual('diasVencimento').get(function() {
  const agora = new Date();
  return Math.ceil((this.dataVencimento - agora) / (1000 * 60 * 60 * 24));
});

module.exports = mongoose.model('CertificadoDigital', CertificadoDigitalSchema);
