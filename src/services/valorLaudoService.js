const ValorLaudo = require('../models/ValorLaudo');
const Usuario = require('../models/Usuario');
const mongoose = require('mongoose');

class ValorLaudoService {
  
  /**
   * Busca o valor configurado para um laudo específico
   * @param {ObjectId} tenantId - ID da empresa
   * @param {ObjectId} medicoId - ID do médico
   * @param {ObjectId} tipoExameId - ID do tipo de exame
   * @param {ObjectId} especialidadeId - ID da especialidade
   * @returns {Promise<Number>} - Valor do laudo ou 0 se não encontrado
   */
  static async buscarValorLaudo(tenantId, medicoId, tipoExameId, especialidadeId) {
    try {
      const valorConfig = await ValorLaudo.findOne({
        tenantId,
        medicoId,
        tipoExameId,
        especialidadeId,
        status: 'ativo'
      });

      return valorConfig ? valorConfig.valor : 0;
    } catch (error) {
      console.error('Erro ao buscar valor do laudo:', error);
      return 0;
    }
  }

  /**
   * Calcula o valor total para múltiplos laudos
   * @param {Array} laudos - Array de laudos
   * @returns {Promise<Number>} - Valor total
   */
  static async calcularValorTotal(laudos) {
    let valorTotal = 0;

    for (const laudo of laudos) {
      const valor = await this.buscarValorLaudo(
        laudo.tenant_id,
        laudo.medicoResponsavelId,
        laudo.tipoExameId,
        laudo.especialidadeId
      );
      valorTotal += valor;
    }

    return valorTotal;
  }

  /**
   * Verifica se um médico tem configuração de valores para um tenant
   * @param {ObjectId} medicoId - ID do médico
   * @param {ObjectId} tenantId - ID da empresa
   * @returns {Promise<Boolean>} - True se tem configuração
   */
  static async medicoTemConfiguracaoValores(medicoId, tenantId) {
    try {
      const count = await ValorLaudo.countDocuments({
        medicoId,
        tenantId,
        status: 'ativo'
      });

      return count > 0;
    } catch (error) {
      console.error('Erro ao verificar configuração de valores:', error);
      return false;
    }
  }

  /**
   * Obtém todos os médicos com configuração de valores para um tenant
   * @param {ObjectId} tenantId - ID da empresa
   * @returns {Promise<Array>} - Array de médicos
   */
  static async obterMedicosComValores(tenantId) {
    try {
      const medicos = await ValorLaudo.aggregate([
        {
          $match: {
            tenantId: mongoose.Types.ObjectId(tenantId),
            status: 'ativo'
          }
        },
        {
          $group: {
            _id: '$medicoId',
            totalConfiguracoes: { $sum: 1 },
            valorMedio: { $avg: '$valor' }
          }
        },
        {
          $lookup: {
            from: 'usuarios',
            localField: '_id',
            foreignField: '_id',
            as: 'medico'
          }
        },
        {
          $addFields: {
            medico: { $arrayElemAt: ['$medico', 0] }
          }
        },
        {
          $project: {
            medico: {
              _id: '$medico._id',
              nome: '$medico.nome',
              crm: '$medico.crm'
            },
            totalConfiguracoes: 1,
            valorMedio: { $round: ['$valorMedio', 2] }
          }
        },
        {
          $sort: { 'medico.nome': 1 }
        }
      ]);

      return medicos;
    } catch (error) {
      console.error('Erro ao obter médicos com valores:', error);
      return [];
    }
  }

  /**
   * Valida se um médico pode atender um tipo de exame
   * @param {ObjectId} medicoId - ID do médico
   * @param {ObjectId} especialidadeId - ID da especialidade
   * @returns {Promise<Boolean>} - True se pode atender
   */
  static async validarMedicoEspecialidade(medicoId, especialidadeId) {
    try {
      const medico = await Usuario.findOne({
        _id: medicoId,
        role: 'medico',
        especialidades: especialidadeId
      });

      return !!medico;
    } catch (error) {
      console.error('Erro ao validar médico e especialidade:', error);
      return false;
    }
  }

  /**
   * Cria configurações em lote para um médico
   * @param {ObjectId} medicoId - ID do médico
   * @param {ObjectId} tenantId - ID da empresa
   * @param {Array} configuracoes - Array de configurações
   * @param {ObjectId} criadoPor - ID do usuário que está criando
   * @returns {Promise<Array>} - Array de configurações criadas
   */
  static async criarConfiguracaoLote(medicoId, tenantId, configuracoes, criadoPor) {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();
      const configuracoesCreated = [];

      for (const config of configuracoes) {
        const { especialidadeId, tipoExameId, valor } = config;

        // Validate doctor's specialty
        const isValid = await this.validarMedicoEspecialidade(medicoId, especialidadeId);
        if (!isValid) {
          throw new Error(`Médico não possui a especialidade informada: ${especialidadeId}`);
        }

        // Check if configuration exists
        const existente = await ValorLaudo.findOne({
          medicoId,
          tenantId,
          especialidadeId,
          tipoExameId
        }).session(session);

        if (existente) {
          existente.valor = valor;
          await existente.save({ session });
          configuracoesCreated.push(existente);
        } else {
          const novaConfig = new ValorLaudo({
            medicoId,
            tenantId,
            especialidadeId,
            tipoExameId,
            valor,
            criadoPor
          });
          
          await novaConfig.save({ session });
          configuracoesCreated.push(novaConfig);
        }
      }

      await session.commitTransaction();
      return configuracoesCreated;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

module.exports = ValorLaudoService;