/* ValorLaudo.js (Model) */
const mongoose = require('mongoose');

const ValorLaudoSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  medicoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  especialidadeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Especialidade',
    required: true
  },
  tipoExameId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TipoExame',
    required: true
  },
  valor: {
    type: Number,
    required: true,
    min: 0
  },
  observacoes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Índice único para evitar duplicatas
ValorLaudoSchema.index(
  { tenantId: 1, medicoId: 1, especialidadeId: 1, tipoExameId: 1 },
  { unique: true }
);

module.exports = mongoose.model('ValorLaudo', ValorLaudoSchema);