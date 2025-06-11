const mongoose = require('mongoose');

const TenantSchema = new mongoose.Schema({
  nomeFantasia: { type: String, required: true },
  cnpj: { type: String },
  status: { type: String, enum: ['ativo', 'inativo'], default: 'ativo' },
  dataCadastro: { type: Date, default: Date.now },
  modulosAtivos: [String]
});

module.exports = mongoose.model('Tenant', TenantSchema);
