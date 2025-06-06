const mongoose = require('mongoose');
require('dotenv').config();

const Laudo = require('../models/Laudo');

async function migrarLaudos() {
  try {
    console.log('Iniciando migração dos laudos...');
    
    // Buscar todos os laudos que não têm o campo pagamentoRegistrado
    const laudos = await Laudo.find({
      pagamentoRegistrado: { $exists: false }
    });
    
    console.log(`Encontrados ${laudos.length} laudos para migrar`);
    
    for (const laudo of laudos) {
      laudo.pagamentoRegistrado = false;
      await laudo.save();
    }
    
    console.log('Migração concluída com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('Erro na migração:', error);
    process.exit(1);
  }
}

migrarLaudos();