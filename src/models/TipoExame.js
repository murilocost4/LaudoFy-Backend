const mongoose = require('mongoose');

const TipoExameSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  especialidades: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Especialidade' }],
  urgente: { 
    type: Boolean, 
    default: false,
    required: true
  },
  descricao: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['ativo', 'inativo'],
    default: 'ativo'
  }
}, {
  timestamps: true
});

// Índice para melhorar performance nas consultas
TipoExameSchema.index({ urgente: -1, nome: 1 });

module.exports = mongoose.model('TipoExame', TipoExameSchema);
