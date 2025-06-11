const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const HistoricoSchema = new mongoose.Schema({
  data: {
    type: Date,
    default: Date.now
  },
  usuario: {
    type: String,
    required: false,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  nomeUsuario: {
    type: String,
    required: false,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  acao: {
    type: String,
    required: true,
    enum: [
      'Criação',
      'Atualização', 
      'Assinatura',
      'EnvioEmail',
      'Refação',
      'Cancelamento',
      'ErroEnvio',
      'TransacaoFinanceira'
    ]
  },
  detalhes: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  versao: {
    type: Number
  },
  destinatarioEmail: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  statusEnvio: {
    type: String,
    enum: ['Pendente', 'Enviado', 'Falha']
  },
  mensagemErro: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  }
}, { _id: false });

const LaudoSchema = new mongoose.Schema({
  exame: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exame',
    required: true
  },
  medicoResponsavel: {
    type: String,
    required: true,
    set: v => encrypt(v.trim()),
    get: v => decrypt(v)
  },
  medicoResponsavelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  conclusao: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => decrypt(v)
  },
  laudoOriginal: {
    type: String,
    default: '',
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  laudoAssinado: {
    type: String,
    default: '',
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  // Campos para armazenamento S3
  laudoOriginalKey: {
    type: String, // Chave do arquivo no S3 para laudo original
    default: ''
  },
  laudoAssinadoKey: {
    type: String, // Chave do arquivo no S3 para laudo assinado
    default: ''
  },
  status: {
    type: String,
    enum: [
      'Rascunho',
      'Laudo em processamento', 
      'Laudo realizado', 
      'Laudo assinado',
      'Laudo pronto para assinatura', // Novo status
      'Laudo refeito',
      'Cancelado',
      'Erro ao gerar PDF',
      'Erro no envio'
    ],
    default: 'Rascunho'
  },
  // Campos financeiros adicionados
  valorPago: {
    type: Number,
    default: 0
  },
  // NOVOS CAMPOS PARA CONTROLE DE PAGAMENTO
  pagamentoRegistrado: {
    type: Boolean,
    default: false
  },
  dataPagamento: {
    type: Date
  },
  meioPagamento: {
    type: String,
    enum: ['pix', 'transferencia', 'dinheiro', 'cheque', 'outros']
  },
  observacoesPagamento: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  pagamentoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PagamentoLaudo'
  },
  // CAMPOS PARA ASSINATURA DIGITAL
  arquivoPath: {
    type: String, // URL do PDF assinado
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  assinadoDigitalmente: {
    type: Boolean,
    default: false,
    index: true
  },
  assinadoCom: {
    type: String,
    enum: ['certificado_medico', 'certificado_sistema', 'sem_assinatura', 'upload_manual'],
    default: 'sem_assinatura'
  },
  certificadoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CertificadoDigital'
  },
  configuracaoValor: {
    valorLaudoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ValorLaudo'
    },
    valorSnapshot: {
      type: Number
    },
    dataCalculoValor: {
      type: Date,
      default: Date.now
    }
  },
  valido: {
    type: Boolean,
    default: true,
    index: true
  },
  versao: {
    type: Number,
    default: 1
  },
  laudoAnterior: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo'
  },
  laudoSubstituto: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo'
  },
  motivoRefacao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  motivoSubstituicao: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  historico: [HistoricoSchema],
  criadoPor: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  criadoPorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  },
  atualizadoPor: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  atualizadoPorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  },
  dataAssinatura: {
    type: Date
  },
  dataEnvioEmail: {
    type: Date
  },
  destinatarioEmail: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  ehVersaoAtual: {
    type: Boolean,
    default: true
  },
  publicLink: {
    type: String,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  codigoAcesso: {
    type: String,
    required: true,
    set: v => v ? encrypt(v.trim()) : v,
    get: v => v ? decrypt(v) : v
  },
  tenant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  profissional_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' },
  // Campos adicionais para referências de tipos de exame e especialidade
  tipoExameId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TipoExame'
  },
  especialidadeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Especialidade'
  }
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    getters: true,
    transform: function(doc, ret) {
      const fieldsToDecrypt = [
        'medicoResponsavel', 'conclusao', 'laudoOriginal', 'laudoAssinado',
        'motivoRefacao', 'motivoSubstituicao', 'criadoPor', 'atualizadoPor',
        'destinatarioEmail', 'publicLink', 'observacoesPagamento'
      ];
      
      fieldsToDecrypt.forEach(field => {
        if (ret[field]) ret[field] = doc[field];
      });
      
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    getters: true 
  }
});

// Método para calcular e definir valor do laudo
LaudoSchema.methods.calcularValorPago = async function() {
  try {
    const ValorLaudo = require('./ValorLaudo');
    
    const valorConfig = await ValorLaudo.findOne({
      tenantId: this.tenant_id,
      medicoId: this.medicoResponsavelId,
      tipoExameId: this.tipoExameId,
      especialidadeId: this.especialidadeId
    });

    if (valorConfig) {
      this.valorPago = valorConfig.valor;
      this.configuracaoValor = {
        valorLaudoId: valorConfig._id,
        valorSnapshot: valorConfig.valor,
        dataCalculoValor: new Date()
      };
      
      // Registrar no histórico
      this.historico.push({
        usuario: this.criadoPor || 'Sistema',
        nomeUsuario: 'Sistema Financeiro',
        acao: 'TransacaoFinanceira',
        detalhes: `Valor calculado: R$ ${valorConfig.valor.toFixed(2)}`,
        versao: this.versao
      });
    } else {
      this.valorPago = 0;
      console.warn(`Valor não configurado para médico ${this.medicoResponsavelId} no tenant ${this.tenant_id}`);
    }
  } catch (error) {
    console.error('Erro ao calcular valor do laudo:', error);
    this.valorPago = 0;
  }
};

// Método para registrar pagamento no laudo
LaudoSchema.methods.registrarPagamento = async function(pagamentoId, meioPagamento, observacoes, usuarioId, nomeUsuario, valorPago) {
  try {
    this.pagamentoRegistrado = true;
    this.dataPagamento = new Date();
    this.meioPagamento = meioPagamento;
    this.observacoesPagamento = observacoes;
    this.pagamentoId = pagamentoId;

    // Registrar no histórico
    this.historico.push({
      usuario: usuarioId,
      nomeUsuario: nomeUsuario || 'Sistema Financeiro',
      acao: 'TransacaoFinanceira',
      detalhes: `Pagamento registrado: R$ ${valorPago.toFixed(2)} via ${meioPagamento}`,
      versao: this.versao
    });

    await this.save();
    console.log(`Pagamento registrado no laudo ${this._id}`);
  } catch (error) {
    console.error('Erro ao registrar pagamento no laudo:', error);
    throw error;
  }
};

// Virtuals para relacionamentos (mantidos iguais)
LaudoSchema.virtual('laudosSubsequentes', {
  ref: 'Laudo',
  localField: '_id',
  foreignField: 'laudoAnterior',
  justOne: false
});

LaudoSchema.virtual('paciente', {
  ref: 'Exame',
  localField: 'exame',
  foreignField: '_id',
  justOne: true
});

// Middlewares (atualizados para lidar com campos criptografados)
LaudoSchema.pre('save', function(next) {
  if (this.isNew) {
    this.historico.push({
      usuario: this.criadoPor,
      nomeUsuario: decrypt(this.criadoPor) || this.criadoPor,
      acao: 'Criação',
      detalhes: `Versão ${this.versao} criada`,
      versao: this.versao
    });
  } else if (this.isModified()) {
    this.historico.push({
      usuario: this.atualizadoPor || this.criadoPor,
      nomeUsuario: decrypt(this.atualizadoPor) || decrypt(this.criadoPor) || (this.atualizadoPor || this.criadoPor),
      acao: 'Atualização',
      detalhes: `Alterações na versão ${this.versao}`,
      versao: this.versao
    });
  }
  next();
});

// Métodos atualizados para lidar com campos criptografados
LaudoSchema.methods.registrarEnvioEmail = async function(usuario, nomeUsuario, destinatario, status, mensagemErro = null) {
  this.dataEnvioEmail = new Date();
  this.destinatarioEmail = destinatario;

  this.historico.push({
    usuario: encrypt(usuario.trim()),
    nomeUsuario: encrypt(nomeUsuario.trim()),
    acao: 'EnvioEmail',
    detalhes: mensagemErro ? encrypt(mensagemErro.trim()) : encrypt(`Laudo enviado para ${destinatario}`.trim()),
    versao: this.versao,
    destinatarioEmail: encrypt(destinatario.trim()),
    statusEnvio: status,
    mensagemErro: mensagemErro ? encrypt(mensagemErro.trim()) : null
  });

  await this.save();
};

LaudoSchema.methods.registrarAssinatura = async function(usuario, nomeUsuario, usuarioId) {
  this.status = 'Laudo assinado';
  this.dataAssinatura = new Date();
  this.atualizadoPor = encrypt(usuario.trim());
  this.atualizadoPorId = usuarioId;
  
  this.historico.push({
    usuario: encrypt(usuario.trim()),
    nomeUsuario: encrypt(nomeUsuario.trim()),
    acao: 'Assinatura',
    detalhes: encrypt(`Laudo assinado digitalmente`.trim()),
    versao: this.versao
  });

  await this.save();
};

// Índices (mantidos iguais)
LaudoSchema.index({ status: 1 });
LaudoSchema.index({ exame: 1 });
LaudoSchema.index({ 'historico.data': -1 });
LaudoSchema.index({ dataAssinatura: -1 });
LaudoSchema.index({ medicoResponsavelId: 1 });
LaudoSchema.index({ tenant_id: 1 });
LaudoSchema.index({ valorPago: 1 });
LaudoSchema.index({ pagamentoRegistrado: 1 });
LaudoSchema.index({ dataPagamento: -1 });

module.exports = mongoose.model('Laudo', LaudoSchema);