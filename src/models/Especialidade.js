const mongoose = require('mongoose');

const EspecialidadeSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  descricao: { type: String },
  status: { type: String, enum: ['ativo', 'inativo'], default: 'ativo' },
  tiposExame: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'TipoExame' 
  }]
});

module.exports = mongoose.model('Especialidade', EspecialidadeSchema);
