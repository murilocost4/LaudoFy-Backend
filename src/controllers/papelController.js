const Papel = require('../models/Papel');

exports.listarPapeis = async (req, res) => {
  try {
    const papeis = await Papel.find();
    res.status(200).json(papeis);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar papeis' });
  }
};

exports.criarPapel = async (req, res) => {
  try {
    const papel = new Papel(req.body);
    await papel.save();
    res.status(201).json(papel);
  } catch (err) {
    res.status(400).json({ error: 'Erro ao criar papel' });
  }
};

exports.atualizarPapel = async (req, res) => {
  try {
    const papel = await Papel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!papel) return res.status(404).json({ error: 'Papel não encontrado' });
    res.status(200).json(papel);
  } catch (err) {
    res.status(400).json({ error: 'Erro ao atualizar papel' });
  }
};

exports.deletarPapel = async (req, res) => {
  try {
    const papel = await Papel.findByIdAndDelete(req.params.id);
    if (!papel) return res.status(404).json({ error: 'Papel não encontrado' });
    res.status(200).json({ message: 'Papel deletado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deletar papel' });
  }
};
