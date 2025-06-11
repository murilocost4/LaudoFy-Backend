const CertificadoDigital = require('../models/CertificadoDigital');
const certificadoService = require('../services/certificadoDigitalService');
const AuditLog = require('../models/AuditModel');
const { validationResult } = require('express-validator');

/**
 * Upload e registro de novo certificado digital
 */
exports.uploadCertificado = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        erro: 'Dados inválidos', 
        detalhes: errors.array() 
      });
    }

    const { senha } = req.body;
    const medicoId = req.usuario.id;
    const arquivo = req.file;

    if (!arquivo) {
      return res.status(400).json({ 
        erro: 'Arquivo de certificado é obrigatório' 
      });
    }

    if (!senha) {
      return res.status(400).json({ 
        erro: 'Senha do certificado é obrigatória' 
      });
    }

    // Validar tipo de arquivo
    const tiposPermitidos = ['.pfx', '.p12'];
    const extensao = arquivo.originalname.toLowerCase().substring(arquivo.originalname.lastIndexOf('.'));
    
    if (!tiposPermitidos.includes(extensao)) {
      return res.status(400).json({ 
        erro: 'Tipo de arquivo inválido. Apenas arquivos .pfx ou .p12 são aceitos' 
      });
    }

    // Validar tamanho do arquivo (máximo 5MB)
    if (arquivo.size > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        erro: 'Arquivo muito grande. Tamanho máximo: 5MB' 
      });
    }

    const requestInfo = {
      ip: req.ip,
      userAgent: req.headers['user-agent']
    };

    // Registrar certificado
    const resultado = await certificadoService.registrarCertificado(
      medicoId,
      arquivo,
      senha,
      {},
      requestInfo
    );

    // Log de auditoria
    try {
      await AuditLog.create({
        userId: medicoId,
        action: 'create',
        description: `Certificado digital cadastrado: ${resultado.informacoes.nome}`,
        collectionName: 'certificadosdigitais',
        documentId: resultado.certificadoId,
        before: null,
        after: {
          nome: resultado.informacoes.nome,
          emissor: resultado.informacoes.emissor,
          dataVencimento: resultado.informacoes.dataVencimento
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.usuario.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.status(201).json({
      sucesso: true,
      mensagem: 'Certificado digital cadastrado com sucesso',
      certificado: resultado.informacoes
    });

  } catch (error) {
    console.error('Erro ao fazer upload do certificado');
    
    let statusCode = 500;
    let mensagemErro = 'Erro interno do servidor';

    if (error.message.includes('já existe') || 
        error.message.includes('já está cadastrado')) {
      statusCode = 409;
      mensagemErro = error.message;
    } else if (error.message.includes('vencido') || 
               error.message.includes('inválido') ||
               error.message.includes('senha')) {
      statusCode = 400;
      mensagemErro = error.message;
    }

    res.status(statusCode).json({ 
      erro: mensagemErro,
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Listar certificados do médico logado
 */
exports.listarMeusCertificados = async (req, res) => {
  try {
    const medicoId = req.usuario.id;
    const incluirInativos = req.query.incluirInativos === 'true';

    const certificados = await certificadoService.listarCertificadosMedico(
      medicoId, 
      incluirInativos
    );

    res.json({
      certificados,
      total: certificados.length
    });

  } catch (error) {
    console.error('Erro ao listar certificados');
    res.status(500).json({ 
      erro: 'Erro ao listar certificados',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Obter detalhes de um certificado específico
 */
exports.obterCertificado = async (req, res) => {
  try {
    const { id } = req.params;
    const medicoId = req.usuario.id;

    const certificado = await CertificadoDigital.findOne({
      _id: id,
      medicoId
    }).select('-senhaCertificado -arquivoCertificado -tentativasUso');

    if (!certificado) {
      return res.status(404).json({ 
        erro: 'Certificado não encontrado' 
      });
    }

    res.json({
      certificado: {
        id: certificado._id,
        nomeCertificado: certificado.nomeCertificado,
        numeroSerie: certificado.numeroSerie,
        emissor: certificado.emissor,
        dataEmissao: certificado.dataEmissao,
        dataVencimento: certificado.dataVencimento,
        status: certificado.status,
        diasVencimento: certificado.diasVencimento,
        totalAssinaturas: certificado.totalAssinaturas,
        ultimoUso: certificado.ultimoUso,
        proximoVencimento: certificado.proximoVencimento(),
        algoritmoAssinatura: certificado.algoritmoAssinatura,
        tamanhoChave: certificado.tamanhoChave,
        validado: certificado.validado,
        ativo: certificado.ativo,
        createdAt: certificado.createdAt,
        updatedAt: certificado.updatedAt
      }
    });

  } catch (error) {
    console.error('Erro ao obter certificado');
    res.status(500).json({ 
      erro: 'Erro ao obter certificado',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Ativar/Desativar certificado
 */
exports.alterarStatusCertificado = async (req, res) => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;
    const medicoId = req.usuario.id;

    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ 
        erro: 'Status deve ser true ou false' 
      });
    }

    const certificado = await CertificadoDigital.findOne({
      _id: id,
      medicoId
    });

    if (!certificado) {
      return res.status(404).json({ 
        erro: 'Certificado não encontrado' 
      });
    }

    // Se estiver ativando, verificar se não há conflitos
    if (ativo && !certificado.ativo) {
      const certificadoAtivo = await CertificadoDigital.findOne({
        medicoId,
        ativo: true,
        _id: { $ne: id },
        dataVencimento: { $gt: new Date() }
      });

      if (certificadoAtivo) {
        return res.status(409).json({ 
          erro: 'Já existe um certificado ativo. Desative o atual antes de ativar outro.' 
        });
      }
    }

    const statusAnterior = certificado.ativo;
    certificado.ativo = ativo;
    await certificado.save();

    // Log de auditoria
    try {
      await AuditLog.create({
        userId: medicoId,
        action: 'update',
        description: `Certificado ${ativo ? 'ativado' : 'desativado'}: ${certificado.nomeCertificado}`,
        collectionName: 'certificadosdigitais',
        documentId: certificado._id,
        before: { ativo: statusAnterior },
        after: { ativo },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.usuario.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      sucesso: true,
      mensagem: `Certificado ${ativo ? 'ativado' : 'desativado'} com sucesso`,
      certificado: {
        id: certificado._id,
        ativo: certificado.ativo,
        status: certificado.status
      }
    });

  } catch (error) {
    console.error('Erro ao alterar status do certificado');
    res.status(500).json({ 
      erro: 'Erro ao alterar status do certificado',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Remover certificado
 */
exports.removerCertificado = async (req, res) => {
  try {
    const { id } = req.params;
    const medicoId = req.usuario.id;

    const certificado = await CertificadoDigital.findOne({
      _id: id,
      medicoId
    });

    if (!certificado) {
      return res.status(404).json({ 
        erro: 'Certificado não encontrado' 
      });
    }

    // Verificar se o certificado tem assinaturas recentes
    if (certificado.totalAssinaturas > 0) {
      const umaSemanaAtras = new Date();
      umaSemanaAtras.setDate(umaSemanaAtras.getDate() - 7);
      
      if (certificado.ultimoUso && certificado.ultimoUso > umaSemanaAtras) {
        return res.status(400).json({ 
          erro: 'Não é possível remover certificado usado recentemente. Aguarde pelo menos 7 dias desde o último uso.' 
        });
      }
    }

    await certificadoService.removerCertificado(id, medicoId);

    // Log de auditoria
    try {
      await AuditLog.create({
        userId: medicoId,
        action: 'delete',
        description: `Certificado removido: ${certificado.nomeCertificado}`,
        collectionName: 'certificadosdigitais',
        documentId: certificado._id,
        before: {
          nome: certificado.nomeCertificado,
          emissor: certificado.emissor,
          ativo: certificado.ativo
        },
        after: null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        tenant_id: req.usuario.tenant_id
      });
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria');
    }

    res.json({
      sucesso: true,
      mensagem: 'Certificado removido com sucesso'
    });

  } catch (error) {
    console.error('Erro ao remover certificado');
    res.status(500).json({ 
      erro: 'Erro ao remover certificado',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Validar senha do certificado (para confirmação antes de assinatura)
 */
exports.validarSenhaCertificado = async (req, res) => {
  try {
    const { id } = req.params;
    const { senha } = req.body;
    const medicoId = req.usuario.id;

    if (!senha) {
      return res.status(400).json({ 
        erro: 'Senha é obrigatória' 
      });
    }

    const certificado = await CertificadoDigital.findOne({
      _id: id,
      medicoId
    });

    if (!certificado) {
      return res.status(404).json({ 
        erro: 'Certificado não encontrado' 
      });
    }

    const senhaValida = await certificado.validarSenha(senha);

    if (!senhaValida) {
      await certificado.registrarUso(false, req.ip, 'Tentativa de validação de senha incorreta');
      
      return res.status(400).json({ 
        erro: 'Senha incorreta' 
      });
    }

    res.json({
      sucesso: true,
      valida: true,
      certificado: {
        id: certificado._id,
        nome: certificado.nomeCertificado,
        status: certificado.status,
        dataVencimento: certificado.dataVencimento
      }
    });

  } catch (error) {
    console.error('Erro ao validar senha do certificado');
    res.status(500).json({ 
      erro: 'Erro ao validar senha do certificado',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Obter estatísticas dos certificados do médico
 */
exports.obterEstatisticasCertificados = async (req, res) => {
  try {
    const medicoId = req.usuario.id;

    const estatisticas = await CertificadoDigital.aggregate([
      { $match: { medicoId: new require('mongoose').Types.ObjectId(medicoId) } },
      {
        $group: {
          _id: null,
          totalCertificados: { $sum: 1 },
          certificadosAtivos: { 
            $sum: { 
              $cond: [
                { 
                  $and: [
                    { $eq: ['$ativo', true] },
                    { $gt: ['$dataVencimento', new Date()] }
                  ]
                }, 
                1, 
                0
              ] 
            }
          },
          certificadosVencidos: { 
            $sum: { 
              $cond: [{ $lte: ['$dataVencimento', new Date()] }, 1, 0] 
            }
          },
          totalAssinaturas: { $sum: '$totalAssinaturas' },
          ultimoUso: { $max: '$ultimoUso' }
        }
      }
    ]);

    const resultado = estatisticas[0] || {
      totalCertificados: 0,
      certificadosAtivos: 0,
      certificadosVencidos: 0,
      totalAssinaturas: 0,
      ultimoUso: null
    };

    // Verificar certificados próximos do vencimento
    const proximosVencimento = await certificadoService.verificarVencimentosCertificados(30);
    const meusCertificadosVencimento = proximosVencimento.filter(cert => 
      cert.medico.id.toString() === medicoId
    );

    res.json({
      ...resultado,
      proximosVencimento: meusCertificadosVencimento.length,
      alertas: meusCertificadosVencimento.map(cert => ({
        certificadoId: cert.certificadoId,
        nome: cert.nomeCertificado,
        diasRestantes: cert.diasRestantes,
        dataVencimento: cert.dataVencimento
      }))
    });

  } catch (error) {
    console.error('Erro ao obter estatísticas dos certificados');
    res.status(500).json({ 
      erro: 'Erro ao obter estatísticas dos certificados',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * [ADMIN] Listar todos os certificados (para adminMaster)
 */
exports.listarTodosCertificados = async (req, res) => {
  try {
    if (!req.usuario.isAdminMaster) {
      return res.status(403).json({ 
        erro: 'Acesso negado. Apenas AdminMaster pode visualizar todos os certificados.' 
      });
    }

    const { page = 1, limit = 20, status, vencimento } = req.query;
    const skip = (page - 1) * limit;

    const filtro = {};

    if (status) {
      if (status === 'ativo') {
        filtro.ativo = true;
        filtro.dataVencimento = { $gt: new Date() };
      } else if (status === 'vencido') {
        filtro.dataVencimento = { $lte: new Date() };
      } else if (status === 'inativo') {
        filtro.ativo = false;
      }
    }

    if (vencimento === 'proximo') {
      const dataLimite = new Date();
      dataLimite.setDate(dataLimite.getDate() + 30);
      filtro.dataVencimento = {
        $gte: new Date(),
        $lte: dataLimite
      };
    }

    const [certificados, total] = await Promise.all([
      CertificadoDigital.find(filtro)
        .populate('medicoId', 'nome email crm')
        .select('-senhaCertificado -arquivoCertificado -tentativasUso')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      CertificadoDigital.countDocuments(filtro)
    ]);

    res.json({
      certificados: certificados.map(cert => ({
        id: cert._id,
        medico: {
          id: cert.medicoId._id,
          nome: cert.medicoId.nome,
          email: cert.medicoId.email,
          crm: cert.medicoId.crm
        },
        nomeCertificado: cert.nomeCertificado,
        emissor: cert.emissor,
        dataEmissao: cert.dataEmissao,
        dataVencimento: cert.dataVencimento,
        status: cert.status,
        diasVencimento: cert.diasVencimento,
        totalAssinaturas: cert.totalAssinaturas,
        ultimoUso: cert.ultimoUso,
        createdAt: cert.createdAt
      })),
      paginacao: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Erro ao listar todos os certificados');
    res.status(500).json({ 
      erro: 'Erro ao listar certificados',
      detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;
