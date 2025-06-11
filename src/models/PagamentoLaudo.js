const mongoose = require('mongoose');

const PagamentoLaudoSchema = new mongoose.Schema({
  tenant_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  medicoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  laudos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Laudo'
  }],
  valorTotal: {
    type: Number,
    required: true
  },
  valorDesconto: {
    type: Number,
    default: 0
  },
  percentualDesconto: {
    type: Number,
    default: 0
  },
  valorFinal: {
    type: Number,
    required: true
  },
  meioPagamento: {
    type: String,
    enum: ['pix', 'transferencia', 'dinheiro', 'cheque', 'outros'],
    required: true
  },
  status: {
    type: String,
    enum: ['pendente', 'pago', 'cancelado'],
    default: 'pago'
  },
  observacoes: String,
  dataPagamento: {
    type: Date,
    default: Date.now
  },
  comprovante: String, // URL do comprovante
  registradoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PagamentoLaudo', PagamentoLaudoSchema);