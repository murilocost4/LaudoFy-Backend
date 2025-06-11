const Paciente = require('../models/Paciente');
const AuditLog = require('../models/AuditModel');
const { encrypt, decrypt } = require('../utils/crypto');
const { maskSensitiveData } = require('../utils/helpers');
const mongoose = require('mongoose');

// Helper para descriptografar um paciente
function decryptPaciente(paciente) {
    const result = paciente.toObject ? paciente.toObject() : paciente;
    
    // Garante que campos opcionais sejam tratados corretamente
    return {
        ...result,
        cpf: result.cpf || null,
        dataNascimento: result.dataNascimento || null,
        endereco: result.endereco || null,
        telefone: result.telefone || null
    };
}

// Criar um novo paciente
exports.criarPaciente = async (req, res) => {
    try {
        const { nome, cpf, dataNascimento, endereco, telefone, email } = req.body;
        
        if (!nome || !cpf || !dataNascimento || !endereco || !telefone) {
            return res.status(400).json({ 
                success: false,
                erro: 'Todos os campos obrigatórios devem ser preenchidos' 
            });
        }

        // Verifica se o CPF já está cadastrado (usando criptografia)
        const cpfCriptografado = encrypt(cpf.toString().replace(/\D/g, ''));
        
        // Extrair tenant_id correto - para usuários normais, pegar o primeiro do array
        let tenantId = req.tenant_id;
        if (Array.isArray(tenantId)) {
            tenantId = tenantId[0];
        }
        
        const cpfExistente = await Paciente.findOne({ cpf: cpfCriptografado, tenant_id: tenantId });
        if (cpfExistente) {
            return res.status(409).json({ 
                success: false,
                erro: 'CPF já cadastrado' 
            });
        }

        const paciente = new Paciente({ 
            nome: nome.trim(),
            cpf: cpf.replace(/\D/g, ''), // Será criptografado pelo setter
            dataNascimento: new Date(dataNascimento).toISOString().split('T')[0], // Será criptografado
            endereco: endereco.trim(), // Será criptografado
            telefone: telefone.replace(/\D/g, ''), // Será criptografado
            email: email ? email.toLowerCase().trim() : null,
            tenant_id: tenantId
        });

        await paciente.save();

        // Auditoria com dados mascarados
        await AuditLog.create({
            userId: req.usuario.id,
            action: 'create',
            description: `Novo paciente registrado: ${nome}`,
            collectionName: 'pacientes',
            documentId: paciente._id,
            before: null,
            after: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone']),
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            tenant_id: tenantId
        });

        return res.status(201).json({
            success: true,
            paciente: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone'])
        });

    } catch (err) {
        return res.status(500).json({ 
            success: false,
            erro: 'Erro ao processar a requisição',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Listar pacientes com dados descriptografados - CORRIGIDO
exports.listarPacientes = async (req, res) => {
    try {
        const { nome, cpf } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        
        // Extrair tenant_id correto - para usuários normais, pegar o primeiro do array  
        let tenantIdProcessado = req.tenant_id;
        if (Array.isArray(tenantIdProcessado)) {
            tenantIdProcessado = tenantIdProcessado[0];
        }

        // Filtro base por tenant
        const filtro = req.usuario?.role === 'adminMaster' ? {} : { tenant_id: tenantIdProcessado };

        // **NOVA ABORDAGEM: Buscar todos os pacientes primeiro, depois filtrar no JavaScript**
        
        // Para filtros criptografados, vamos buscar todos e filtrar depois
        let deveAplicarFiltroNome = false;
        let deveAplicarFiltroCPF = false;
        let termoBuscaNome = '';
        let termoBuscaCPF = '';

        if (nome && nome.trim() !== '') {
            deveAplicarFiltroNome = true;
            termoBuscaNome = nome.trim().toLowerCase();
        }

        if (cpf && cpf.trim() !== '') {
            deveAplicarFiltroCPF = true;
            // Limpar CPF removendo caracteres não numéricos
            termoBuscaCPF = cpf.replace(/\D/g, '');
        }

        // Buscar pacientes com populate
        let pacientesQuery = Paciente.find(filtro)
            .populate('tenant_id', 'nomeFantasia')
            .limit(limit * 2) // Buscar mais para compensar filtros que serão aplicados
            .sort({ nome: 1 });

        let pacientesEncontrados = await pacientesQuery.lean();
        
        // **APLICAR FILTROS EM JAVASCRIPT (após descriptografia)**
        let pacientesFiltrados = pacientesEncontrados;

        // Filtro por NOME (após descriptografia)
        if (deveAplicarFiltroNome) {
            
            pacientesFiltrados = pacientesFiltrados.filter(paciente => {
                try {
                    // Descriptografar o nome do paciente
                    let nomeDescriptografado = paciente.nome;
                    if (typeof nomeDescriptografado === 'string' && nomeDescriptografado.includes(':')) {
                        nomeDescriptografado = decrypt(nomeDescriptografado);
                    }
                    
                    const match = nomeDescriptografado.toLowerCase().includes(termoBuscaNome);
                    if (match) {
                    }
                    return match;
                } catch (error) {
                    return false;
                }
            });            
        }

        // Filtro por CPF (após descriptografia)
        if (deveAplicarFiltroCPF) {
            
            pacientesFiltrados = pacientesFiltrados.filter(paciente => {
                try {
                    // Descriptografar o CPF do paciente
                    let cpfDescriptografado = paciente.cpf;
                    if (typeof cpfDescriptografado === 'string' && cpfDescriptografado.includes(':')) {
                        cpfDescriptografado = decrypt(cpfDescriptografado);
                    }
                    
                    // Remover formatação do CPF descriptografado
                    const cpfLimpo = cpfDescriptografado.replace(/\D/g, '');
                    
                    // Verificar se o CPF buscado está contido no CPF do paciente (busca parcial)
                    const match = cpfLimpo.includes(termoBuscaCPF);
                    if (match) {
                    }
                    return match;
                } catch (error) {
                    return false;
                }
            });
        }

        // Aplicar limite após filtros
        const pacientesPaginados = pacientesFiltrados.slice(0, limit);

        // **DESCRIPTOGRAFAR TODOS OS CAMPOS PARA RESPOSTA**
        const pacientesFinais = pacientesPaginados.map(paciente => {
            const pacienteFormatado = { ...paciente };
            
            // Descriptografar nome
            if (pacienteFormatado.nome && typeof pacienteFormatado.nome === 'string' && pacienteFormatado.nome.includes(':')) {
                try {
                    pacienteFormatado.nome = decrypt(pacienteFormatado.nome);
                } catch (err) {
                    pacienteFormatado.nome = 'Nome não disponível';
                }
            }

            // Descriptografar CPF
            if (pacienteFormatado.cpf && typeof pacienteFormatado.cpf === 'string' && pacienteFormatado.cpf.includes(':')) {
                try {
                    pacienteFormatado.cpf = decrypt(pacienteFormatado.cpf);
                } catch (err) {
                    pacienteFormatado.cpf = '';
                }
            }

            // Descriptografar outros campos
            ['endereco', 'telefone', 'dataNascimento'].forEach(field => {
                if (pacienteFormatado[field] && typeof pacienteFormatado[field] === 'string' && pacienteFormatado[field].includes(':')) {
                    try {
                        pacienteFormatado[field] = decrypt(pacienteFormatado[field]);
                    } catch (err) {
                        pacienteFormatado[field] = '';
                    }
                }
            });

            return pacienteFormatado;
        });

        res.status(200).json(pacientesFinais);
    } catch (err) {
        res.status(500).json({ 
            success: false,
            error: 'Erro ao processar a requisição',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Obter paciente por ID
exports.obterPaciente = async (req, res) => {
    try {
        const paciente = await Paciente.findById(req.params.id);
        if (!paciente) {
            return res.status(404).json({ error: 'Paciente não encontrado' });
        }
        res.status(200).json(paciente);
    } catch (err) {
        res.status(500).json({ 
            error: 'Erro interno no servidor'
        });
    }
};

// Atualizar paciente (já atualizado para usar descriptografia)
exports.atualizarPaciente = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const pacienteAntes = await Paciente.findById(id);
        if (!pacienteAntes) {
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        // Verifica se está tentando modificar campos imutáveis
        if (req.body.cpf && req.body.cpf !== decrypt(pacienteAntes.cpf)) {
            return res.status(403).json({ erro: 'CPF não pode ser alterado' });
        }

        const camposPermitidos = ['nome', 'dataNascimento', 'endereco', 'telefone', 'email'];
        const atualizacao = {};
        
        camposPermitidos.forEach(campo => {
            if (req.body[campo] !== undefined) {
                if (campo === 'email' && req.body[campo]) {
                    atualizacao[campo] = req.body[campo].toLowerCase().trim();
                } else {
                    atualizacao[campo] = req.body[campo];
                }
            }
        });

        const pacienteAtualizado = await Paciente.findByIdAndUpdate(id, atualizacao, {
            new: true,
            runValidators: true,
        });

        let tenantId = req.tenant_id;
        if (Array.isArray(tenantId)) {
            tenantId = tenantId[0];
        }

        await AuditLog.create({
            userId: req.usuario.id,
            action: 'update',
            description: `Paciente atualizado: ${pacienteAtualizado.nome}`,
            collectionName: 'pacientes',
            documentId: id,
            before: maskSensitiveData(decryptPaciente(pacienteAntes), ['cpf', 'email', 'telefone']),
            after: maskSensitiveData(decryptPaciente(pacienteAtualizado), ['cpf', 'email', 'telefone']),
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            tenant_id: tenantId
        });

        res.status(200).json({
            success: true,
            paciente: maskSensitiveData(decryptPaciente(pacienteAtualizado), ['cpf', 'email', 'telefone'])
        });

    } catch (err) {
        res.status(500).json({ 
            success: false,
            erro: 'Erro ao processar a requisição',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Deletar paciente
exports.deletarPaciente = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const paciente = await Paciente.findById(id);
        if (!paciente) {
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        await Paciente.findByIdAndDelete(id);

        let tenantId = req.tenant_id;
        if (Array.isArray(tenantId)) {
            tenantId = tenantId[0];
        }

        await AuditLog.create({
            userId: req.usuario.id,
            action: 'delete',
            description: `Paciente removido: ${paciente.nome}`,
            collectionName: 'pacientes',
            documentId: id,
            before: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone']),
            after: null,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            tenant_id: tenantId
        });

        res.status(200).json({ 
            success: true,
            mensagem: 'Paciente deletado com sucesso' 
        });
    } catch (err) {
        res.status(500).json({ 
            erro: 'Erro interno no servidor',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};