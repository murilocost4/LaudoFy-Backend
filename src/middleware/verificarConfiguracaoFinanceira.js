// middlewares/verificarConfiguracaoFinanceira.js
const ConfiguracaoFinanceira = require('../models/ConfiguracaoFinanceira');

module.exports = async (req, res, next) => {
  try {
    const medicoId = req.usuario.id;
    
    const config = await ConfiguracaoFinanceira.findOne({
      medico: medicoId,
      ativo: true
    }).sort({ createdAt: -1 });

    if (!config) {
      return res.status(400).json({
        erro: 'Médico não possui configuração financeira ativa. Configure os valores antes de emitir laudos.'
      });
    }

    req.configFinanceira = config;
    next();
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao verificar configuração financeira' });
  }
};