const Exame = require('../models/Exame');
const Paciente = require('../models/Paciente');
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const Laudo = require('../models/Laudo');
const AuditLog = require('../models/AuditModel')
const { encrypt, decrypt } = require('../utils/crypto');
const { gerarThumbnailPDF } = require('../utils/pdfToThumbnail');
const Usuario = require('../models/Usuario');
const TipoExame = require('../models/TipoExame');
const mongoose = require('mongoose');
const { format } = require('date-fns');
const { promisify } = require('util');

const { uploadPDFToUploadcare } = require('../services/uploadcareService.js');
const { gerarThumbnailPDFRemoto } = require('../utils/pdfUtils.js');
const { v4: uuidv4 } = require('uuid');
const { deleteFile } = require('../services/storageServiceV3.js');

// Função para calcular a idade com base na data de nascimento
const calcularIdade = (dataNascimento) => {
    const hoje = new Date();
    const nascimento = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const mes = hoje.getMonth() - nascimento.getMonth();
    if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
        idade--;
    }
    return idade;
};

// Validações para criação de exame
exports.validarExame = [
    body('paciente').notEmpty().withMessage('O nome do paciente é obrigatório'),
    body('observacoes').notEmpty().withMessage('As observações são obrigatórias'),
    body('segmentoPR').optional().isFloat({ gt: 0 }).withMessage('O segmento PR deve ser um número positivo'),
    body('frequenciaCardiaca').optional().isFloat({ gt: 0 }).withMessage('A frequência cardíaca deve ser um número positivo'),
    body('duracaoQRS').optional().isFloat({ gt: 0 }).withMessage('A duração do QRS deve ser um número positivo'),
    body('eixoMedioQRS').optional().isFloat().withMessage('O eixo médio do QRS deve ser um número válido'),
    body('altura').optional().isFloat({ gt: 0 }).withMessage('A altura deve ser um número positivo'),
    body('peso').optional().isFloat({ gt: 0 }).withMessage('O peso deve ser um número positivo'),
];

// Upload de exame - SEM AUDITORIA (processo técnico)
exports.uploadExame = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    }

    const pdfPath = req.file.path;
    const thumbnailDir = path.join(__dirname, '../../uploads/thumbnails');
    
    // Criar diretório de thumbnails se não existir
    if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    const thumbnailPath = path.join(thumbnailDir, `thumbnail_${req.file.filename.replace('.pdf', '.png')}`);

    try {
        await gerarThumbnailPDF(pdfPath, thumbnailPath);
        res.status(200).json({ 
            mensagem: 'PDF e thumbnail processados com sucesso',
            thumbnailPath: `uploads/thumbnails/${path.basename(thumbnailPath)}`
        });
    } catch (err) {
        console.error('Erro ao gerar thumbnail');
        
        // Tentar limpar arquivos em caso de erro
        try {
            if (fs.existsSync(thumbnailPath)) {
                fs.unlinkSync(thumbnailPath);
            }
        } catch (cleanupErr) {
            console.error('Erro ao limpar arquivos');
        }
        
        res.status(500).json({ 
            erro: 'Falha na geração de thumbnail',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Criar um novo exame com upload de arquivo - APENAS SUCESSO
exports.criarExame = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ erros: errors.array() });
        }

        const {
            paciente, tipoExame, observacoes, segmentoPR,
            frequenciaCardiaca, duracaoQRS, eixoMedioQRS,
            altura, peso
        } = req.body;

        if (!req.file) {
            console.error('Arquivo não enviado');
            logger.error('Arquivo não enviado');
            return res.status(400).json({ erro: 'Arquivo não enviado' });
        }

        const pacienteInfo = await Paciente.findById(paciente);
        if (!pacienteInfo) {
            console.error('Paciente não encontrado');
            logger.error('Paciente não encontrado');
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        const usuarioId = req.usuarioId;
        let tenantId = req.tenant_id;

        // CORRIGIDO: Garantir que temos um ObjectId válido
        if (Array.isArray(tenantId)) {
            if (tenantId.length > 0) {
                // Se é array de objetos, pegar o _id do primeiro
                if (typeof tenantId[0] === 'object' && tenantId[0]._id) {
                    tenantId = tenantId[0]._id;
                } else {
                    tenantId = tenantId[0];
                }
            } else {
                console.error('Tenant não identificado');
                return res.status(400).json({ erro: 'Tenant não identificado' });
            }
        }

        // Garantir que tenantId é um ObjectId válido
        if (!mongoose.Types.ObjectId.isValid(tenantId)) {
            console.error('Tenant inválido');
            return res.status(400).json({ erro: 'Tenant inválido' });
        }

        const validarEnum = (valor, campo, valoresPermitidos) => {
            if (!valoresPermitidos.map(v => v.toLowerCase()).includes(String(valor).toLowerCase())) {
                throw new Error(`${campo} inválido: ${valor}. Valores permitidos: ${valoresPermitidos.join(', ')}`);
            }
        };

        const statusExame = req.body.status || 'Pendente';
        validarEnum(statusExame, 'status', ['Pendente', 'Concluído', 'Laudo realizado']);

        // Upload para S3 (substitui UploadCare)
        if (!req.file) {
            return res.status(400).json({
                success: false,
                erro: 'Arquivo é obrigatório'
            });
        }

        // Com multer-s3, o arquivo já foi enviado para S3
        const arquivoURL = req.file.location; // URL do S3
        const arquivoKey = req.file.key; // Chave para futuras operações

        const tipoExameDoc = await TipoExame.findById(tipoExame);
        if (!tipoExameDoc) {
            console.error('Tipo de exame não encontrado');
            return res.status(404).json({ erro: 'Tipo de exame não encontrado' });
        }

        // CORRIGIDO: Status sem criptografia - o modelo fará isso automaticamente
        const dadosExame = {
            paciente: new mongoose.Types.ObjectId(paciente),
            tipoExame: tipoExameDoc._id,
            observacoes: observacoes,
            arquivo: arquivoURL,
            arquivoKey: arquivoKey, // NOVO: Chave do S3
            tecnico: new mongoose.Types.ObjectId(usuarioId),
            status: statusExame, // Valor não criptografado - o setter do modelo vai criptografar
            tenant_id: new mongoose.Types.ObjectId(tenantId),
            dataExame: new Date()
        };

        // Adicionar campos opcionais apenas se tiverem valores
        if (segmentoPR && segmentoPR !== '') {
            dadosExame.segmentoPR = parseFloat(segmentoPR);
        }
        if (frequenciaCardiaca && frequenciaCardiaca !== '') {
            dadosExame.frequenciaCardiaca = parseFloat(frequenciaCardiaca);
        }
        if (duracaoQRS && duracaoQRS !== '') {
            dadosExame.duracaoQRS = parseFloat(duracaoQRS);
        }
        if (eixoMedioQRS && eixoMedioQRS !== '') {
            dadosExame.eixoMedioQRS = parseFloat(eixoMedioQRS);
        }
        if (altura && altura !== '') {
            dadosExame.altura = parseFloat(altura);
        }
        if (peso && peso !== '') {
            dadosExame.peso = parseFloat(peso);
        }

        const exame = new Exame(dadosExame);
        await exame.save();

        // **LOG DE SUCESSO DA CRIAÇÃO**
        try {
            // Descriptografar nome do paciente para auditoria
            let nomePacienteDescriptografado = pacienteInfo.nome;
            if (typeof nomePacienteDescriptografado === 'string' && nomePacienteDescriptografado.includes(':')) {
                nomePacienteDescriptografado = decrypt(nomePacienteDescriptografado);
            }

            // Descriptografar CPF do paciente para auditoria
            let cpfPacienteDescriptografado = pacienteInfo.cpf;
            if (typeof cpfPacienteDescriptografado === 'string' && cpfPacienteDescriptografado.includes(':')) {
                cpfPacienteDescriptografado = decrypt(cpfPacienteDescriptografado);
            }

            await AuditLog.create({
                userId: new mongoose.Types.ObjectId(usuarioId),
                action: 'create',
                description: `Novo exame criado para o paciente ${nomePacienteDescriptografado} (${cpfPacienteDescriptografado})`,
                collectionName: 'exames',
                documentId: exame._id,
                before: null,
                after: {
                    id: exame._id,
                    paciente: nomePacienteDescriptografado,
                    tipoExame: tipoExameDoc.nome,
                    status: statusExame, // Status original não criptografado para auditoria
                    arquivo: arquivoURL
                },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: new mongoose.Types.ObjectId(tenantId)
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.status(201).json({
            success: true,
            exame: exame.toObject()
        });

    } catch (err) {
        console.error('Erro ao criar exame');
        
        logger.error(`Erro ao criar exame: ${err.message}`);
        res.status(400).json({
            success: false,
            erro: err.message || 'Erro ao criar exame'
        });
    }
};

// Listar exames - SEM AUDITORIA (consulta)
exports.listarExames = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // 1. Construir query base (apenas filtros que funcionam com criptografia)
        const baseQuery = {};
        
        // Filtro de tenant
        if (req.usuario.role !== 'adminMaster') {
            let tenantId = req.usuario.tenant_id;
            
            if (Array.isArray(tenantId) && tenantId.length > 0) {
                // CORRIGIDO: Processar array de objetos tenant_id corretamente
                const tenantObjectIds = tenantId.map(tenant => {
                    if (typeof tenant === 'object' && tenant._id) {
                        return new mongoose.Types.ObjectId(tenant._id);
                    } else if (typeof tenant === 'string') {
                        return new mongoose.Types.ObjectId(tenant);
                    }
                    return tenant;
                });
                baseQuery.tenant_id = { $in: tenantObjectIds };
            } else if (tenantId) {
                if (typeof tenantId === 'string') {
                    baseQuery.tenant_id = new mongoose.Types.ObjectId(tenantId);
                } else {
                    baseQuery.tenant_id = tenantId;
                }
            } else {
                return res.json({
                    exames: [],
                    page,
                    limit,
                    total: 0,
                    totalPages: 0
                });
            }
        }

        // 2. Filtro por especialidade para médicos
        if (req.usuario.role === 'medico') {
            if (req.usuario.especialidades && req.usuario.especialidades.length > 0) {
                const TipoExame = require('../models/TipoExame');
                const especialidadeObjectIds = req.usuario.especialidades.map(id => 
                    typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
                );
                
                const tipos = await TipoExame.find({
                    especialidades: { $in: especialidadeObjectIds }
                }).select('_id');
                
                if (tipos.length > 0) {
                    const tiposExamePermitidos = tipos.map(tipo => tipo._id);
                    baseQuery.tipoExame = { $in: tiposExamePermitidos };
                } else {
                    return res.json({
                        exames: [],
                        page,
                        limit,
                        total: 0,
                        totalPages: 0
                    });
                }
            } else {
                return res.json({
                    exames: [],
                    page,
                    limit,
                    total: 0,
                    totalPages: 0
                });
            }
        }

        // 3. Filtros que podem ser aplicados diretamente no banco
        if (req.query.tipoExame && req.query.tipoExame.trim() !== '') {
            const tipoExameId = new mongoose.Types.ObjectId(req.query.tipoExame);
            // Se já temos filtro de especialidade, fazer intersecção
            if (baseQuery.tipoExame && baseQuery.tipoExame.$in) {
                if (baseQuery.tipoExame.$in.some(id => id.equals(tipoExameId))) {
                    baseQuery.tipoExame = tipoExameId;
                } else {
                    return res.json({
                        exames: [],
                        page,
                        limit,
                        total: 0,
                        totalPages: 0
                    });
                }
            } else {
                baseQuery.tipoExame = tipoExameId;
            }
        }
        
        if (req.query.dataInicio || req.query.dataFim) {
            baseQuery.dataExame = {};
            if (req.query.dataInicio && req.query.dataInicio.trim() !== '') {
                baseQuery.dataExame.$gte = new Date(req.query.dataInicio);
            }
            if (req.query.dataFim && req.query.dataFim.trim() !== '') {
                const dataFim = new Date(req.query.dataFim);
                dataFim.setHours(23, 59, 59, 999);
                baseQuery.dataExame.$lte = dataFim;
            }
        }

        // 4. Buscar exames com populate
        const examesQuery = Exame.find(baseQuery)
            .populate({
                path: 'tipoExame',
                select: 'nome urgente especialidades'
            })
            .populate({
                path: 'paciente',
                select: 'nome idade dataNascimento email cpf'
            })
            .populate({
                path: 'tecnico',
                select: 'nome email'
            })
            .populate({
                path: 'tenant_id',
                select: 'nomeFantasia'
            });

        let examesEncontrados = await examesQuery.lean();

        // 5. APLICAR FILTROS EM JAVASCRIPT (após descriptografia)
        let examesFiltrados = examesEncontrados;

        // Filtro por STATUS (após descriptografia)
        if (req.query.status && req.query.status.trim() !== '') {
            const statusDesejado = req.query.status.trim();
            
            examesFiltrados = examesFiltrados.filter(exame => {
                try {
                    let statusDescriptografado = exame.status;
                    if (typeof statusDescriptografado === 'string' && statusDescriptografado.includes(':')) {
                        statusDescriptografado = decrypt(statusDescriptografado);
                    }
                    
                    return statusDescriptografado === statusDesejado;
                } catch (error) {
                    console.error('Erro ao descriptografar status');
                    return false;
                }
            });
        }

        // Filtro por URGENTE
        if (req.query.urgente !== undefined && req.query.urgente !== '') {
            const isUrgenteFilter = req.query.urgente === 'true';
            
            examesFiltrados = examesFiltrados.filter(exame => {
                const isUrgenteExame = exame.tipoExame?.urgente === true;
                return isUrgenteExame === isUrgenteFilter;
            });
        }

        // Filtro por PACIENTE (após descriptografia)
        if (req.query.paciente && req.query.paciente.trim() !== '') {
            const termoBusca = req.query.paciente.toLowerCase();
            
            examesFiltrados = examesFiltrados.filter(exame => {
                if (!exame.paciente?.nome) return false;
                
                try {
                    let nomeDescriptografado = exame.paciente.nome;
                    if (typeof nomeDescriptografado === 'string' && nomeDescriptografado.includes(':')) {
                        nomeDescriptografado = decrypt(nomeDescriptografado);
                    }
                    
                    return nomeDescriptografado.toLowerCase().includes(termoBusca);
                } catch (error) {
                    console.error('Erro ao descriptografar nome do paciente');
                    return false;
                }
            });
        }

        // 5.5. DESCRIPTOGRAFAR STATUS PARA ORDENAÇÃO
        examesFiltrados.forEach(exame => {
            if (exame.status && typeof exame.status === 'string' && exame.status.includes(':')) {
                try {
                    exame.status = decrypt(exame.status);
                } catch (err) {
                    console.error('Erro ao descriptografar status para ordenação:', err);
                    exame.status = 'Pendente';
                }
            }
        });

        // 6. ORDENAÇÃO FINAL
        examesFiltrados.sort((a, b) => {
            // Status já descriptografado na etapa anterior
            const statusA = a.status;
            const statusB = b.status;
            
            const aTemLaudo = statusA === 'Laudo realizado';
            const bTemLaudo = statusB === 'Laudo realizado';
            
            // 1. Primeiro: Separar pendentes dos realizados
            if (aTemLaudo !== bTemLaudo) {
                // Pendentes (false) vêm antes de realizados (true)
                return aTemLaudo - bTemLaudo;
            }
            
            // 2. Se ambos são pendentes, urgentes vêm primeiro
            if (!aTemLaudo && !bTemLaudo) {
                const aUrgente = a.tipoExame?.urgente === true ? 1 : 0;
                const bUrgente = b.tipoExame?.urgente === true ? 1 : 0;
                
                if (aUrgente !== bUrgente) {
                    return bUrgente - aUrgente; // Urgentes primeiro
                }
            }
            
            // 3. Para o resto (mesma urgência ou ambos realizados), ordenar por data (mais recentes primeiro)
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const total = examesFiltrados.length;
        const totalPages = Math.ceil(total / limit);
        const examesPaginados = examesFiltrados.slice(skip, skip + limit);

        // 8. DESCRIPTOGRAFAR TODOS OS CAMPOS PARA RESPOSTA
        const examesFinais = examesPaginados.map(exame => {
            const exameFormatado = { ...exame };
            
            // Status já foi descriptografado na etapa de ordenação
            // Não precisa descriptografar novamente
            
            // Descriptografar outros campos
            ['arquivo', 'observacoes'].forEach(field => {
                if (exameFormatado[field] && typeof exameFormatado[field] === 'string' && exameFormatado[field].includes(':')) {
                    try {
                        exameFormatado[field] = decrypt(exameFormatado[field]);
                    } catch (err) {
                        console.error(`Erro ao descriptografar ${field}`);
                        exameFormatado[field] = '';
                    }
                }
            });

            // Descriptografar nome do paciente
            if (exameFormatado.paciente && exameFormatado.paciente.nome) {
                try {
                    if (typeof exameFormatado.paciente.nome === 'string' && exameFormatado.paciente.nome.includes(':')) {
                        exameFormatado.paciente.nome = decrypt(exameFormatado.paciente.nome);
                    }
                } catch (err) {
                    console.error('Erro ao descriptografar nome do paciente');
                    exameFormatado.paciente.nome = 'Nome não disponível';
                }
            }

            // Descriptografar nome do técnico
            if (exameFormatado.tecnico && exameFormatado.tecnico.nome) {
                try {
                    if (typeof exameFormatado.tecnico.nome === 'string' && exameFormatado.tecnico.nome.includes(':')) {
                        exameFormatado.tecnico.nome = decrypt(exameFormatado.tecnico.nome);
                    }
                } catch (err) {
                    console.error('Erro ao descriptografar nome do técnico');
                    exameFormatado.tecnico.nome = 'Nome não disponível';
                }
            }

            return exameFormatado;
        });

        res.json({
            exames: examesFinais,
            page,
            limit,
            total: total,
            totalPages: totalPages
        });

    } catch (err) {
        console.error('Erro ao listar exames');
        res.status(500).json({
            message: 'Error retrieving exams',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Obter um exame por ID - SEM AUDITORIA (consulta)
exports.obterExame = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ erro: 'ID do exame inválido' });
    }

    let query = { _id: id };

    if (user.role !== 'adminMaster') {
      if (Array.isArray(user.tenant_id)) {
        query.tenant_id = { $in: user.tenant_id };
      } else {
        query.tenant_id = user.tenant_id;
      }
    }

    const exame = await Exame.findOne(query)
      .populate('paciente', 'nome dataNascimento')
      .populate('tipoExame', 'nome')
      .populate('tecnico', 'nome')
      .populate('tenant_id', 'nomeFantasia');

    if (!exame) {
      return res.status(404).json({ erro: 'Exame não encontrado' });
    }

    res.json(exame);
  } catch (err) {
    logger.error('Erro ao obter exame:', err);
    res.status(500).json({ 
      erro: 'Erro interno do servidor',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Atualizar um exame - APENAS SUCESSO
exports.atualizarExame = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ erro: 'ID do exame inválido' });
        }

        // CORRIGIDO: Extrair tenant_id corretamente
        let tenantId = req.tenant_id;
        
        if (Array.isArray(tenantId)) {
            if (tenantId.length > 0) {
                if (typeof tenantId[0] === 'object' && tenantId[0]._id) {
                    tenantId = tenantId[0]._id;
                } else {
                    tenantId = tenantId[0];
                }
            } else {
                return res.status(400).json({ erro: 'Tenant não identificado' });
            }
        }

        const exameExistente = await Exame.findOne({ 
            _id: id, 
            tenant_id: new mongoose.Types.ObjectId(tenantId)
        })
        .populate('paciente')
        .populate('tipoExame')
        .populate('tecnico', 'nome email');

        if (!exameExistente) {
            return res.status(404).json({ erro: 'Exame não encontrado' });
        }

        // Verificar se o exame já tem laudo realizado (status será descriptografado pelo getter)
        const statusAtual = exameExistente.status;
        if (statusAtual === 'Laudo realizado') {
            return res.status(403).json({ 
                erro: 'Não é possível atualizar um exame que já possui laudo realizado',
                codigo: 'EXAME_COM_LAUDO'
            });
        }

        // Preparar dados antes da atualização para auditoria
        const dadosAntes = {
            paciente: exameExistente.paciente?.nome,
            tipoExame: exameExistente.tipoExame?.nome,
            status: statusAtual, // Já descriptografado pelo getter
            observacoes: exameExistente.observacoes // Já descriptografado pelo getter
        };

        // Preparar dados para atualização
        const updateData = {};
        
        if (req.body.paciente) updateData.paciente = new mongoose.Types.ObjectId(req.body.paciente);
        if (req.body.tipoExame) updateData.tipoExame = new mongoose.Types.ObjectId(req.body.tipoExame);
        if (req.body.observacoes) updateData.observacoes = req.body.observacoes;
        
        const numericFields = ['segmentoPR', 'frequenciaCardiaca', 'duracaoQRS', 'eixoMedioQRS', 'altura', 'peso'];
        numericFields.forEach(field => {
            if (req.body[field] !== undefined && req.body[field] !== '') {
                updateData[field] = parseFloat(req.body[field]);
            }
        });

        // CORRIGIDO: Validar status se fornecido
        if (req.body.status) {
            if (req.body.status === 'Laudo realizado') {
                return res.status(403).json({ 
                    erro: 'O status "Laudo realizado" só pode ser definido através da criação de um laudo',
                    codigo: 'STATUS_INVALIDO'
                });
            }
            
            // Validar enum
            const validarEnum = (valor, campo, valoresPermitidos) => {
                if (!valoresPermitidos.map(v => v.toLowerCase()).includes(String(valor).toLowerCase())) {
                    throw new Error(`${campo} inválido: ${valor}. Valores permitidos: ${valoresPermitidos.join(', ')}`);
                }
            };
            
            validarEnum(req.body.status, 'status', ['Pendente', 'Concluído', 'Laudo realizado']);
            updateData.status = req.body.status; // O setter do modelo vai criptografar
        }

        // Arquivo - só atualizar se um novo foi enviado
        if (req.file) {
            try {
                // Com S3, o arquivo já foi enviado
                const arquivoURL = req.file.location; // URL do S3
                const arquivoKey = req.file.key; // Chave do S3
                
                // Deletar arquivo antigo do S3 se existir
                if (exameExistente.arquivoKey) {
                    try {
                        await deleteFile(exameExistente.arquivoKey);
                    } catch (deleteError) {
                        console.error('Erro ao deletar arquivo antigo do S3:', deleteError);
                        // Não falhar a operação por erro na exclusão do arquivo antigo
                    }
                }
                
                updateData.arquivo = arquivoURL;
                updateData.arquivoKey = arquivoKey;
            } catch (uploadError) {
                console.error('Erro no upload');
                return res.status(500).json({ erro: 'Erro ao fazer upload do arquivo' });
            }
        }

        // Atualizar o exame
        const exameAtualizado = await Exame.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        )
        .populate('paciente', 'nome dataNascimento cpf')
        .populate('tipoExame', 'nome')
        .populate('tecnico', 'nome email')
        .populate('tenant_id', 'nomeFantasia');

        // **LOG DE SUCESSO DA ATUALIZAÇÃO**
        try {
            // Descriptografar dados para auditoria
            let nomePacienteAtualizado = exameAtualizado.paciente?.nome;
            if (typeof nomePacienteAtualizado === 'string' && nomePacienteAtualizado.includes(':')) {
                nomePacienteAtualizado = decrypt(nomePacienteAtualizado);
            }

            const dadosDepois = {
                paciente: nomePacienteAtualizado,
                tipoExame: exameAtualizado.tipoExame?.nome,
                status: exameAtualizado.status, // Getter já descriptografa
                observacoes: exameAtualizado.observacoes // Getter já descriptografa
            };

            await AuditLog.create({
                userId: new mongoose.Types.ObjectId(req.usuarioId),
                action: 'update',
                description: `Exame atualizado para o paciente ${nomePacienteAtualizado}`,
                collectionName: 'exames',
                documentId: exameAtualizado._id,
                before: dadosAntes,
                after: dadosDepois,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: new mongoose.Types.ObjectId(tenantId)
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.json({
            success: true,
            message: 'Exame atualizado com sucesso',
            exame: exameAtualizado
        });

    } catch (err) {
        console.error('Erro ao atualizar exame');
        res.status(500).json({
            success: false,
            erro: err.message || 'Erro interno do servidor'
        });
    }
};

// Deletar um exame - APENAS SUCESSO
exports.deletarExame = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid exam ID' });
        }

        const tenantId = Array.isArray(req.usuario.tenant_id) 
            ? req.usuario.tenant_id[0] 
            : req.usuario.tenant_id;

        const exame = await Exame.findOne({
            _id: id,
            tenant_id: tenantId
        }).populate('paciente', 'nome cpf');

        if (!exame) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        // Verificar se o exame já tem laudo realizado
        const statusAtual = exame.status;
        if (statusAtual === 'Laudo realizado') {
            return res.status(403).json({ 
                erro: 'Não é possível excluir um exame que já possui laudo realizado',
                codigo: 'EXAME_COM_LAUDO',
                message: 'Cannot delete exam with completed report'
            });
        }

        // Dados antes da exclusão para auditoria
        let nomePaciente = exame.paciente?.nome;
        if (typeof nomePaciente === 'string' && nomePaciente.includes(':')) {
            nomePaciente = decrypt(nomePaciente);
        }

        let cpfPaciente = exame.paciente?.cpf;
        if (typeof cpfPaciente === 'string' && cpfPaciente.includes(':')) {
            cpfPaciente = decrypt(cpfPaciente);
        }

        const dadosAntes = {
            paciente: nomePaciente,
            cpf: cpfPaciente,
            status: statusAtual,
            dataExame: exame.dataExame
        };

        // Deletar arquivo do S3 se existir
        if (exame.arquivoKey) {
            try {
                await deleteFile(exame.arquivoKey);
                console.log(`Arquivo do S3 deletado: ${exame.arquivoKey}`);
            } catch (err) {
                console.error(`Erro ao deletar arquivo do S3: ${exame.arquivoKey}`, err);
                // Não falhar a operação por erro na exclusão do arquivo
            }
        }

        // Proceder com a exclusão
        await Exame.findByIdAndDelete(id);

        // **LOG DE SUCESSO DA EXCLUSÃO**
        try {
            await AuditLog.create({
                userId: req.usuarioId,
                action: 'delete',
                description: `Exame excluído do paciente ${nomePaciente} (${cpfPaciente})`,
                collectionName: 'exames',
                documentId: id,
                before: dadosAntes,
                after: null,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: tenantId
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        // REMOVIDO: Lógica antiga de arquivos locais
        // Delete associated files if they exist
        if (exame.arquivos && exame.arquivos.length > 0) {
            for (const arquivo of exame.arquivos) {
                try {
                    await fs.promises.unlink(path.join(__dirname, '../../uploads', arquivo));
                } catch (err) {
                    console.error(`Erro ao deletar arquivo ${arquivo}`);
                }
            }
        }

        res.json({ 
            message: 'Exam deleted successfully',
            success: true
        });
    } catch (err) {
        console.error('Erro ao deletar exame');
        res.status(500).json({
            message: 'Error deleting exam',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Download do arquivo de um exame - SEM AUDITORIA (acesso a arquivo)
exports.downloadArquivo = async (req, res) => {
    try {
        const { getSignedUrl } = require('../services/storageServiceV3');
        
        const exame = await Exame.findById(req.params.id);
        if (!exame) {
            return res.status(404).json({ erro: 'Exame não encontrado' });
        }

        // Se o exame tem arquivoKey (S3), gerar URL pré-assinada
        if (exame.arquivoKey) {
            try {
                // Gerar URL pré-assinada válida por 1 hora
                const signedUrl = await getSignedUrl(exame.arquivoKey, 3600);
                return res.json({ 
                    downloadUrl: signedUrl,
                    expiresIn: 3600 // 1 hora em segundos
                });
            } catch (error) {
                console.error('Erro ao gerar URL pré-assinada:', error);
                return res.status(500).json({ erro: 'Erro ao gerar link de download' });
            }
        }

        // Fallback para URLs antigas (UploadCare ou outras)
        if (exame.arquivo) {
            // Se for URL do UploadCare ou externa, retornar diretamente
            if (exame.arquivo.includes('ucarecdn.com') || exame.arquivo.startsWith('http')) {
                return res.json({ 
                    downloadUrl: exame.arquivo,
                    expiresIn: null // URLs externas não expiram
                });
            }
        }

        return res.status(404).json({ erro: 'Arquivo não encontrado' });
    } catch (err) {
        console.error('Erro no download do exame:', err);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
};

// Listar exames para seleção - SEM AUDITORIA (consulta simples)
exports.listarExamesParaSelecao = async (req, res) => {
    try {
        const { paciente, tipoExame } = req.query;
        const filtro = {};

        if (paciente) {
            filtro.paciente = new RegExp(paciente, 'i');
        }
        if (tipoExame) {
            filtro.tipoExame = tipoExame;
        }

        const exames = await Exame.find(filtro).select('_id paciente tipoExame status');
        res.status(200).json(exames);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};

// Listar exames sem laudo - SEM AUDITORIA (consulta simples)
exports.listarExamesSemLaudo = async (req, res) => {
    try {
        const laudos = await Laudo.find().select('exame');
        const examesComLaudo = laudos.map((laudo) => laudo.exame.toString());

        const examesSemLaudo = await Exame.find({ _id: { $nin: examesComLaudo } }).select(
            '_id paciente tipoExame status'
        );

        res.status(200).json(examesSemLaudo);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};

// Upload exam files - APENAS SUCESSO
exports.uploadArquivos = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid exam ID' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        const tenantId = Array.isArray(req.usuario.tenant_id) 
            ? req.usuario.tenant_id[0] 
            : req.usuario.tenant_id;

        const exame = await Exame.findOne({ 
            _id: id,
            tenant_id: tenantId 
        });

        if (!exame) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        // Add new files to the exam
        const arquivos = req.files.map(file => file.filename);
        exame.arquivos = [...(exame.arquivos || []), ...arquivos];
        await exame.save();

        // **LOG DE SUCESSO DO UPLOAD**
        try {
            await AuditLog.create({
                userId: req.usuarioId,
                action: 'upload',
                description: `${arquivos.length} arquivo(s) adicionado(s) ao exame ${id}`,
                collectionName: 'exames',
                documentId: id,
                before: { arquivos: exame.arquivos.filter(a => !arquivos.includes(a)) },
                after: { arquivos: exame.arquivos },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: tenantId
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.json({
            message: 'Files uploaded successfully',
            files: arquivos
        });
    } catch (err) {
        console.error('Erro ao fazer upload de arquivos');
        res.status(500).json({
            message: 'Error uploading files',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Delete exam file - APENAS SUCESSO
exports.deletarArquivo = async (req, res) => {
    try {
        const { id, filename } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid exam ID' });
        }

        const tenantId = Array.isArray(req.usuario.tenant_id) 
            ? req.usuario.tenant_id[0] 
            : req.usuario.tenant_id;

        const exame = await Exame.findOne({ 
            _id: id,
            tenant_id: tenantId 
        });

        if (!exame) {
            return res.status(404).json({ message: 'Exam not found' });
        }

        if (!exame.arquivos.includes(filename)) {
            return res.status(404).json({ message: 'File not found in exam' });
        }

        // Remove file from filesystem
        try {
            await fs.promises.unlink(path.join(__dirname, '../../uploads', filename));
        } catch (err) {
            console.error(`Erro ao deletar arquivo ${filename}`);
        }

        // Remove file from exam
        const arquivosAntes = [...exame.arquivos];
        exame.arquivos = exame.arquivos.filter(arquivo => arquivo !== filename);
        await exame.save();

        // **LOG DE SUCESSO DA EXCLUSÃO DO ARQUIVO**
        try {
            await AuditLog.create({
                userId: req.usuarioId,
                action: 'delete',
                description: `Arquivo ${filename} removido do exame ${id}`,
                collectionName: 'exames',
                documentId: id,
                before: { arquivos: arquivosAntes },
                after: { arquivos: exame.arquivos },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: tenantId
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.json({ message: 'File deleted successfully' });
    } catch (err) {
        console.error('Erro ao deletar arquivo');
        res.status(500).json({
            message: 'Error deleting file',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Get exam statistics - LOG DE VISUALIZAÇÃO OPCIONAL
exports.obterEstatisticas = async (req, res) => {
    try {
        const { dataInicio, dataFim } = req.query;
        let query = {};

        if (req.usuario.role !== 'adminMaster') {
            let tenantId = req.usuario.tenant_id;
            
            if (Array.isArray(tenantId) && tenantId.length > 0) {
                const tenantObjectIds = tenantId.map(id => {
                    if (typeof id === 'string') {
                        return new mongoose.Types.ObjectId(id);
                    }
                    return id;
                });
                query.tenant_id = { $in: tenantObjectIds };
            } else if (tenantId) {
                if (typeof tenantId === 'string') {
                    query.tenant_id = new mongoose.Types.ObjectId(tenantId);
                } else {
                    query.tenant_id = tenantId;
                }
            } else {
                return res.json({
                    totalExames: 0,
                    examesUrgentes: 0,
                    examesPorStatus: [],
                    examesPorTipo: [],
                    examesPorTecnico: []
                });
            }
        }

        // Filtro por especialidade para médicos nas estatísticas
        if (req.usuario.role === 'medico') {
            if (req.usuario.especialidades && req.usuario.especialidades.length > 0) {
                const TipoExame = require('../models/TipoExame');
                const especialidadeObjectIds = req.usuario.especialidades.map(id => 
                    typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
                );
                
                const tiposExamePermitidos = await TipoExame.find({
                    especialidades: { $in: especialidadeObjectIds }
                }).select('_id');
                
                const tiposExameIds = tiposExamePermitidos.map(tipo => tipo._id);
                
                if (tiposExameIds.length > 0) {
                    query.tipoExame = { $in: tiposExameIds };
                } else {
                    return res.json({
                        totalExames: 0,
                        examesUrgentes: 0,
                        examesPorStatus: [],
                        examesPorTipo: [],
                        examesPorTecnico: []
                    });
                }
            } else {
                return res.json({
                    totalExames: 0,
                    examesUrgentes: 0,
                    examesPorStatus: [],
                    examesPorTipo: [],
                    examesPorTecnico: []
                });
            }
        }

        if (dataInicio || dataFim) {
            query.dataExame = {};
            if (dataInicio) query.dataExame.$gte = new Date(dataInicio);
            if (dataFim) {
                const dataFim_end = new Date(dataFim);
                dataFim_end.setHours(23, 59, 59, 999);
                query.dataExame.$lte = dataFim_end;
            }
        }

        // Nova abordagem para estatísticas
        const exames = await Exame.find(query)
            .populate({
                path: 'tipoExame',
                select: 'nome urgente'
            })
            .populate({
                path: 'tecnico',
                select: 'nome'
            })
            .lean();

        // Processar estatísticas
        const totalExames = exames.length;
        let examesUrgentes = 0;
        const statusCount = {};
        const tipoCount = {};
        const tecnicoCount = {};

        exames.forEach(exame => {
            // Contar urgentes
            if (exame.tipoExame?.urgente === true) {
                examesUrgentes++;
            }

            // Contar por status (descriptografar primeiro)
            try {
                let status = exame.status;
                if (typeof status === 'string' && status.includes(':')) {
                    status = decrypt(status);
                }
                statusCount[status] = (statusCount[status] || 0) + 1;
            } catch (error) {
                console.error('Erro ao descriptografar status para estatísticas');
                statusCount['Pendente'] = (statusCount['Pendente'] || 0) + 1;
            }

            // Contar por tipo
            const tipoNome = exame.tipoExame?.nome || 'Tipo não informado';
            tipoCount[tipoNome] = (tipoCount[tipoNome] || 0) + 1;

            // Contar por técnico
            if (exame.tecnico) {
                try {
                    let tecnicoNome = exame.tecnico.nome;
                    if (typeof tecnicoNome === 'string' && tecnicoNome.includes(':')) {
                        tecnicoNome = decrypt(tecnicoNome);
                    }
                    tecnicoCount[tecnicoNome] = (tecnicoCount[tecnicoNome] || 0) + 1;
                } catch (error) {
                    console.error('Erro ao descriptografar nome do técnico');
                    tecnicoCount['Técnico não identificado'] = (tecnicoCount['Técnico não identificado'] || 0) + 1;
                }
            }
        });

        // Formatar resposta
        const examesPorStatus = Object.entries(statusCount).map(([status, total]) => ({
            status,
            total
        }));

        const examesPorTipo = Object.entries(tipoCount).map(([_id, total]) => ({
            _id,
            total
        }));

        const examesPorTecnico = Object.entries(tecnicoCount).map(([nome, total]) => ({
            nome,
            total
        }));

        const estatisticas = {
            totalExames,
            examesUrgentes,
            examesPorStatus,
            examesPorTipo,
            examesPorTecnico
        };

        // **LOG DE VISUALIZAÇÃO OPCIONAL**
        if (req.query.audit === 'true') {
            try {
                await AuditLog.create({
                    userId: req.usuario.id,
                    action: 'view',
                    description: 'Consultou estatísticas de exames',
                    collectionName: 'exames',
                    documentId: null,
                    before: null,
                    after: estatisticas,
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    tenant_id: req.usuario.tenant_id
                });
            } catch (auditError) {
                console.error('Erro ao criar log de auditoria');
            }
        }

        res.json(estatisticas);
    } catch (err) {
        console.error('Erro ao obter estatísticas');
        res.status(500).json({
            message: 'Error retrieving exam statistics',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Helper functions - sem alteração
const encryptFields = (data) => {
    const fieldsToEncrypt = ['tipoExame', 'status', 'observacoes'];
    const encrypted = { ...data };
    
    fieldsToEncrypt.forEach(field => {
        if (encrypted[field]) {
            encrypted[field] = encrypt(encrypted[field]);
        }
    });
    
    return encrypted;
};

const decryptFields = (data) => {
    const fieldsToDecrypt = ['tipoExame', 'status', 'observacoes'];
    const decrypted = { ...data };
    
    fieldsToDecrypt.forEach(field => {
        if (decrypted[field]) {
            try {
                decrypted[field] = decrypt(decrypted[field]);
            } catch (err) {
                console.error(`Erro ao descriptografar ${field}`);
            }
        }
    });
    
    return decrypted;
};