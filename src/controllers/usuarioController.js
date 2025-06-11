const { default: mongoose } = require('mongoose');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditModel');
const { encrypt } = require('../utils/crypto');
const { validationResult } = require('express-validator');
const validator = require('validator');

// Criar um novo usuário (apenas admins)
exports.criarUsuario = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ erro: 'Dados inválidos', detalhes: errors.array() });
        }

        const { nome, email, senha, role, crm, isAdminMaster, tenant_id, especialidades, ativo, permissaoFinanceiro } = req.body;

        if (!validator.isEmail(email)) {
            return res.status(400).json({ erro: 'Email inválido' });
        }

        if (!['admin', 'medico', 'tecnico', 'recepcionista', 'adminMaster'].includes(role)) {
            return res.status(400).json({ erro: 'Função de usuário inválida' });
        }

        // Verificar se médico já existe (apenas para role médico e não adminMaster)
        if (role === 'medico' && !req.usuario.isAdminMaster) {
            const medicoExistente = await Usuario.findOne({
                $or: [
                    { email: email },
                    { crm: crm }
                ],
                role: 'medico'
            });

            if (medicoExistente) {
                return res.status(400).json({ 
                    erro: 'Este médico já está cadastrado no sistema. Entre em contato com o suporte para liberar o acesso para sua empresa.' 
                });
            }
        }

        // Validações de tenant_id
        if (!req.usuario.isAdminMaster) {
            if (role === 'medico') {
                // Para médicos criados por admin comum, usar apenas o tenant_id do admin
                req.body.tenant_id = [req.usuario.tenant_id];
            } else {
                // Para outros roles, usar o tenant_id do admin
                req.body.tenant_id = req.usuario.tenant_id;
            }
        }

        const usuario = new Usuario({ 
            nome, 
            email, 
            senha, 
            role, 
            crm, 
            tenant_id: Array.isArray(req.body.tenant_id) ? req.body.tenant_id : [req.body.tenant_id], 
            isAdminMaster,
            especialidades: especialidades || [],
            ativo: ativo !== undefined ? ativo : true,
            permissaoFinanceiro: permissaoFinanceiro !== undefined ? permissaoFinanceiro : false
        });
        
        await usuario.save();

        const usuarioResponse = usuario.toObject();
        delete usuarioResponse.senha;
        delete usuarioResponse.refreshToken;
        delete usuarioResponse.resetSenhaToken;

        try {
            await AuditLog.create({
                userId: req.usuario?._id,
                action: 'create',
                description: `Novo usuário registrado: ${email}`,
                collectionName: 'usuarios',
                documentId: usuario._id,
                before: null,
                after: usuarioResponse,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: req.usuario.tenant_id
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.status(201).json({
            mensagem: 'Usuário criado com sucesso',
            usuario: usuarioResponse
        });

    } catch (err) {
        console.error('Erro ao criar usuário');
        res.status(500).json({ erro: 'Erro interno ao criar usuário' });
    }
};

// Listar todos os usuários com paginação e filtros - CORRIGIDO
exports.listarUsuarios = async (req, res) => {
    try {
        const { nome, email, role, dataInicio, dataFim, page = 1, limit = 10 } = req.query;

        // **NOVA ABORDAGEM: Buscar todos primeiro, depois filtrar no JavaScript**
        
        // Filtro base por tenant
        const filtro = req.usuario.isAdminMaster ? {} : { tenant_id: { $in: req.tenant_id } };

        // Aplicar apenas filtros que funcionam com dados não criptografados
        if (email && email.trim() !== '') {
            filtro.email = { $regex: email.trim(), $options: 'i' };
        }
        
        if (role && ['admin', 'tecnico', 'medico', 'recepcionista'].includes(role)) {
            filtro.role = role;
        }

        if (dataInicio || dataFim) {
            filtro.createdAt = {};
            if (dataInicio) {
                filtro.createdAt.$gte = new Date(dataInicio);
            }
            if (dataFim) {
                filtro.createdAt.$lte = new Date(dataFim);
            }
        }

        // Verificar se precisa aplicar filtro por nome
        let deveAplicarFiltroNome = false;
        let termoBuscaNome = '';

        if (nome && nome.trim() !== '') {
            deveAplicarFiltroNome = true;
            termoBuscaNome = nome.trim().toLowerCase();
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // **Buscar usuários - Se tiver filtro de nome, buscar mais para compensar a filtragem posterior**
        const limiteBusca = deveAplicarFiltroNome ? parseInt(limit) * 2 : parseInt(limit);

        let usuarios = await Usuario.find(filtro)
            .populate('tenant_id', 'nomeFantasia')
            .populate('especialidades', 'nome') // Adicionar esta linha
            .select('-senha -refreshToken -resetSenhaToken')
            .skip(skip)
            .limit(limiteBusca)
            .sort({ createdAt: -1 });

        // Se tiver filtro de nome, aplicar filtragem adicional no JavaScript
        if (deveAplicarFiltroNome) {
            usuarios = usuarios.filter(usuario => {
                const nomeUsuario = usuario.nome ? usuario.nome.toLowerCase() : '';
                return nomeUsuario.includes(termoBuscaNome);
            });
        }

        // Pegar apenas o número total de usuários que atendem ao filtro original (sem a filtragem por nome)
        const total = await Usuario.countDocuments(filtro);

        return res.status(200).json({
            usuarios,
            total,
            totalPaginas: Math.ceil(total / limit),
            paginaAtual: parseInt(page),
            limite: parseInt(limit)
        });

    } catch (err) {
        return res.status(500).json({ 
            erro: 'Erro ao listar usuários',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Obter um usuário específico pelo ID
exports.getUsuario = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const usuario = await Usuario.findById(req.params.id)
            .select('-senha -refreshToken -resetSenhaToken');

        if (!usuario) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.status(200).json(usuario);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar usuário' });
    }
};

// Atualizar um usuário
exports.atualizarUsuario = async (req, res) => {
    try {
        const { nome, email, role, senha, crm, isAdminMaster, tenant_id, especialidades, ativo, permissaoFinanceiro } = req.body;
        const usuarioId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(usuarioId)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const usuario = await Usuario.findById(usuarioId);
        if (!usuario) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        // Atualiza os campos com sanitização básica
        if (nome && typeof nome === 'string') usuario.nome = nome.trim();
        if (email && validator.isEmail(email)) usuario.email = email.trim();
        if (senha && senha.length >= 6) usuario.senha = senha;
        if (role && ['admin', 'medico', 'tecnico'].includes(role)) usuario.role = role;
        if (crm && typeof crm === 'string') usuario.crm = crm.trim();
        if (isAdminMaster !== undefined) usuario.isAdminMaster = isAdminMaster;
        if (especialidades) usuario.especialidades = especialidades;
        if (ativo !== undefined) usuario.ativo = ativo;
        if (permissaoFinanceiro !== undefined) usuario.permissaoFinanceiro = permissaoFinanceiro;

        // Set tenant_id based on role
        if (role === 'adminMaster') {
            usuario.tenant_id = []; // Admin master doesn't need tenant_id
        } else if (role === 'medico') {
            usuario.tenant_id = tenant_id;
        } else {
            usuario.tenant_id = Array.isArray(tenant_id) ? [tenant_id[0]] : [tenant_id];
        }

        await usuario.save();

        const usuarioAtualizado = await Usuario.findById(usuarioId)
            .select('-senha -refreshToken -resetSenhaToken');

        // Create audit log before sending response
        try {
            await AuditLog.create({
                userId: req.usuario?._id,
                action: 'update',
                description: `Usuário atualizado: ${email || usuario.email}`,
                collectionName: 'usuarios',
                documentId: usuario._id,
                before: null,
                after: usuarioAtualizado.toObject(),
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria');
        }

        res.status(200).json({
            mensagem: 'Usuário atualizado com sucesso',
            usuario: usuarioAtualizado
        });

    } catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar usuário' });
    }
};

// Verificar se médico já existe
exports.verificarMedicoExistente = async (req, res) => {
    try {
        const { email, crm } = req.query;
        
        // Verificar se pelo menos um dos campos foi fornecido e não está vazio
        const emailValido = email && email.trim() !== '';
        const crmValido = crm && crm.trim() !== '';
        
        if (!emailValido && !crmValido) {
            return res.status(400).json({ erro: 'Email ou CRM são obrigatórios' });
        }

        const query = { role: 'medico' };
        
        // Construir query OR apenas com campos válidos
        const orConditions = [];
        if (emailValido) orConditions.push({ email: email.trim() });
        if (crmValido) orConditions.push({ crm: crm.trim() });
        
        if (orConditions.length > 0) {
            query.$or = orConditions;
        }

        const medicoExistente = await Usuario.findOne(query);
        
        res.json({
            exists: !!medicoExistente,
            message: medicoExistente 
                ? 'Médico já cadastrado no sistema' 
                : 'Médico não encontrado'
        });

    } catch (err) {
        console.error('Erro ao verificar médico');
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
};

// Listar médicos para filtros - SEM AUDITORIA (consulta)
exports.listarMedicos = async (req, res) => {
    try {
        const { tenant_id } = req.query;
        
        // Build filter
        let filtro = { role: 'medico', ativo: true };
        
        // AdminMaster can filter by tenant or see all
        if (req.usuario.role === 'adminMaster') {
            if (tenant_id) {
                filtro.tenant_id = { $in: [tenant_id] };
            }
        } else {
            // Other users only see doctors from their tenant
            if (Array.isArray(req.usuario.tenant_id)) {
                filtro.tenant_id = { $in: req.usuario.tenant_id };
            } else if (req.usuario.tenant_id) {
                filtro.tenant_id = { $in: [req.usuario.tenant_id] };
            }
        }
        
        const medicos = await Usuario.find(filtro)
            .select('_id nome crm especialidades')
            .populate('especialidades', 'nome')
            .sort({ nome: 1 });
        
        res.status(200).json({
            success: true,
            usuarios: medicos.map(medico => medico.toObject()), // Convert to plain object with getters applied
            total: medicos.length
        });
        
    } catch (err) {
        console.error('Erro ao listar médicos');
        res.status(500).json({ 
            erro: 'Erro ao listar médicos',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};