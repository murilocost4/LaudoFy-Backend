const Usuario = require('../models/Usuario');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const AuditLog = require('../models/AuditModel'); // Adicionado
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sgTransport = require('@sendgrid/mail');
const { sendPasswordResetEmail } = require('../services/emailService');
const AuthService = require('../services/authService');
const axios = require('axios');

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

// Gerar tokens (access token e refresh token)
const gerarTokens = (usuario) => {
    const accessToken = jwt.sign(
      { 
        id: usuario._id, 
        nome: usuario.nome, 
        role: usuario.role, 
        tenant_id: usuario.tenant_id,
        isAdminMaster: usuario.isAdminMaster,
        papeis: usuario.papeis,
        permissoes: usuario.permissoes,
        permissaoFinanceiro: usuario.permissaoFinanceiro,
        ativo: usuario.ativo
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
    return { accessToken, refreshToken, hashedRefreshToken };
  };

// Validação para email de recuperação
exports.validarEmail = [
    body('email').isEmail().withMessage('Email inválido')
];

// Validação para reset de senha
exports.validarResetSenha = [
    body('token').notEmpty().withMessage('Token é obrigatório'),
    body('senha').isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres')
];

// Configuração do transporter de email (adicione suas credenciais)
const transporter = nodemailer.createTransport({
    service: 'gmail', // ou outro serviço
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Exporta a função gerarTokens
module.exports.gerarTokens = gerarTokens;

// Validações para registro de usuário
exports.validarRegistro = [
    body('nome').notEmpty().withMessage('O nome é obrigatório'),
    body('email').isEmail().withMessage('Email inválido'),
    body('senha').isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres'),
    body('role').isIn(['medico', 'tecnico', 'admin']).withMessage('Role inválida'),
];

// Registrar um novo usuário - APENAS SUCESSO
exports.registrar = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ erro: 'Credenciais inválidas' });
        }

        const { nome, email, senha, role } = req.body;

        const usuarioExistente = await Usuario.findOne({ email, tenant_id: req.tenant_id });
        if (usuarioExistente) {
            return res.status(400).json({ erro: 'Credenciais inválidas' });
        }

        const usuario = new Usuario({ nome, email, senha, role, tenant_id: req.tenant_id });
        await usuario.save();

        const { accessToken, refreshToken } = gerarTokens(usuario);
        const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
        usuario.refreshToken = hashedRefresh;
        await usuario.save();

        // **APENAS LOG DE SUCESSO**
        try {
            await AuditLog.create({
                userId: usuario._id,
                action: 'create',
                description: `Novo usuário registrado: ${email}`,
                collectionName: 'usuarios',
                documentId: usuario._id,
                before: null,
                after: {
                    id: usuario._id,
                    nome: usuario.nome,
                    email: usuario.email,
                    role: usuario.role
                },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: req.tenant_id
            });
        } catch (auditError) {
        }

        res.status(201).json({ accessToken, refreshToken });
    } catch (err) {
        return res.status(400).json({ erro: 'Credenciais inválidas' });
    }
};

// Validações para login de usuário
exports.validarLogin = [
    body('email').isEmail().withMessage('Email inválido'),
    body('senha').notEmpty().withMessage('A senha é obrigatória'),
];

// Login de usuário - APENAS SUCESSO
exports.login = async (req, res) => {
    try {
        const { email, senha } = req.body;

        const usuario = await Usuario.findOne({ email })
            .populate('tenant_id', 'nomeFantasia nome status')
            .populate('especialidades', 'nome');

        if (!usuario || !(await usuario.compararSenha(senha))) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        // Verificar se o usuário está ativo
        if (!usuario.ativo) {
            return res.status(401).json({ erro: 'Usuário inativo. Entre em contato com o administrador.' });
        }

        const nomeDescriptografado = usuario.nome;

        const accessTokenPayload = {
            id: usuario._id,
            nome: nomeDescriptografado,
            email: usuario.email,
            role: usuario.role,
            tenant_id: usuario.tenant_id,
            especialidades: usuario.especialidades,
            isAdminMaster: usuario.isAdminMaster,
            permissaoFinanceiro: usuario.permissaoFinanceiro,
            ativo: usuario.ativo
        };

        const refreshTokenPayload = {
            id: usuario._id,
            type: 'refresh'
        };

        const accessToken = jwt.sign(accessTokenPayload, process.env.JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = jwt.sign(refreshTokenPayload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

        const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
        usuario.refreshToken = hashedRefreshToken;
        await usuario.save();

        // **LOG DE SUCESSO DO LOGIN**
        try {
            await AuditLog.create({
                userId: usuario._id,
                action: 'login',
                description: `Login realizado com sucesso para: ${email}`,
                collectionName: 'auth',
                documentId: usuario._id,
                before: null,
                after: {
                    email: email,
                    role: usuario.role,
                    loginTime: new Date()
                },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: usuario.tenant_id._id || usuario.tenant_id
            });
        } catch (auditError) {
        }

        res.json({
            accessToken,
            refreshToken,
            usuario: {
                id: usuario._id,
                nome: nomeDescriptografado,
                email: usuario.email,
                role: usuario.role,
                tenant_id: usuario.tenant_id,
                especialidades: usuario.especialidades,
                isAdminMaster: usuario.isAdminMaster
            }
        });
    } catch (err) {
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
};

// Refresh Token - APENAS SUCESSO
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({ erro: 'Refresh token necessário' });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const usuario = await Usuario.findOne({
            _id: decoded.id,
            refreshToken: hashedToken
        })
        .populate('tenant_id')
        .populate('especialidades');

        if (!usuario) {
            return res.status(401).json({ erro: 'Refresh token inválido' });
        }

        const nomeDescriptografado = usuario.nome;

        const newAccessTokenPayload = {
            id: usuario._id,
            nome: nomeDescriptografado,
            email: usuario.email,
            role: usuario.role,
            tenant_id: usuario.tenant_id,
            especialidades: usuario.especialidades,
            isAdminMaster: usuario.isAdminMaster,
            permissaoFinanceiro: usuario.permissaoFinanceiro
        };

        const newAccessToken = jwt.sign(newAccessTokenPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

        // **LOG DE SUCESSO DO REFRESH TOKEN**
        try {
            await AuditLog.create({
                userId: usuario._id,
                action: 'refresh_token',
                description: `Token atualizado com sucesso para: ${usuario.email}`,
                collectionName: 'auth',
                documentId: usuario._id,
                before: null,
                after: {
                    refreshTime: new Date()
                },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: usuario.tenant_id._id || usuario.tenant_id
            });
        } catch (auditError) {
        }

        res.json({
            accessToken: newAccessToken,
            usuario: {
                id: usuario._id,
                nome: nomeDescriptografado,
                email: usuario.email,
                role: usuario.role,
                tenant_id: usuario.tenant_id,
                especialidades: usuario.especialidades,
                isAdminMaster: usuario.isAdminMaster
            }
        });
    } catch (err) {
        res.status(401).json({ erro: 'Refresh token inválido' });
    }
};

// Esqueci minha senha - REMOVER AUDITORIA (não é sucesso de ação do usuário)
exports.esqueciSenha = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ erro: 'Email é obrigatório' });
        }

        const result = await AuthService.solicitarResetSenha(email);
        
        if (!result) {
            return res.status(200).json({
                mensagem: 'Se o email existir, um link será enviado'
            });
        }

        await sendPasswordResetEmail(email, result.resetToken);

        res.status(200).json({ 
            mensagem: 'Se o email estiver cadastrado, você receberá um link de recuperação' 
        });

    } catch (error) {
        res.status(500).json({ 
            erro: 'Erro ao processar solicitação',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Resetar senha - APENAS SUCESSO
exports.resetarSenha = async (req, res) => {
    try {
        const { token, senha } = req.body;

        if (!token || !senha) {
            return res.status(400).json({ erro: 'Token e nova senha são obrigatórios' });
        }

        if (senha.length < 6) {
            return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres' });
        }

        const usuario = await AuthService.resetarSenha(token, senha);

        // **LOG DE SUCESSO DO RESET DE SENHA**
        try {
            await AuditLog.create({
                userId: usuario._id,
                action: 'password_reset',
                description: `Senha redefinida com sucesso para: ${usuario.email}`,
                collectionName: 'auth',
                documentId: usuario._id,
                before: null,
                after: {
                    passwordResetTime: new Date()
                },
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                tenant_id: usuario.tenant_id
            });
        } catch (auditError) {
        }

        res.status(200).json({ 
            mensagem: 'Senha redefinida com sucesso',
            usuario: {
                id: usuario._id,
                email: usuario.email,
                nome: usuario.nome,
                role: usuario.role
            }
        });

    } catch (error) {
        
        const statusCode = error.message.includes('Token inválido') ? 400 : 500;
        
        res.status(statusCode).json({ 
            erro: error.message.includes('Token inválido') 
                ? error.message 
                : 'Erro ao redefinir senha',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Verificar token - REMOVER AUDITORIA (não é ação de modificação)
exports.verificarToken = async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({ erro: 'Token é obrigatório' });
        }

        const valido = await AuthService.verificarTokenReset(token);
        res.status(200).json({ valido });

    } catch (error) {
        res.status(500).json({ 
            erro: 'Erro ao verificar token',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};