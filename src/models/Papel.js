const mongoose = require('mongoose');

const PapelSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  descricao: { type: String },
  permissoes: [{
    modulo: String,
    acoes: [String]
  }]
});

module.exports = mongoose.model('Papel', PapelSchema);
