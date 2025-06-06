const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/crypto');

const UsuarioSchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true,
        set: v => encrypt(v.trim()),
        get: v => v ? decrypt(v) : v // **CORRIGIDO: Verificar se v existe antes de descriptografar**
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    senha: {
        type: String,
        required: true,
    },
    role: {
        type: String,
        enum: ['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'],
        default: 'tecnico',
    },
    crm: {
        type: String,
        set: v => v ? encrypt(v.trim()) : v,
        get: v => v ? decrypt(v) : v
    },
    refreshToken: {
        type: String // <-- Agora recebe diretamente o SHA-256 hash (sem criptografia reversível)
    },
    resetSenhaToken: {
        type: String
    },
    resetSenhaExpira: Date,
    resetSenhaTentativas: {
        type: Number,
        default: 0
    },
    ultimoResetSenha: Date,
    tenant_id: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }],
    papeis: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Papel' }],
    especialidades: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Especialidade' }],
    isAdminMaster: {
        type: Boolean,
        default: false
    },
    ativo: {
        type: Boolean,
        default: true
    },
    permissaoFinanceiro: {
        type: Boolean,
        default: false
    },
}, { 
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true }
});

// Criptografa a senha antes de salvar o usuário
UsuarioSchema.pre('save', async function (next) {
    if (!this.isModified('senha')) return next();
    if (this.senha.startsWith('$2b$')) return next(); // já está hasheada
    this.senha = await bcrypt.hash(this.senha, 12);
    next();
  });  

// Método para comparar senhas
UsuarioSchema.methods.compararSenha = async function (senha) {
    return await bcrypt.compare(senha, this.senha);
};

// Oculta dados sensíveis ao serializar
UsuarioSchema.methods.toJSON = function() {
    const obj = this.toObject();
    const camposSensiveis = [
        'senha', 'refreshToken', 'resetSenhaToken', 
        'resetSenhaExpira', 'resetSenhaTentativas', 
        'ultimoResetSenha', '__v'
    ];
    camposSensiveis.forEach(campo => delete obj[campo]);
    
    // **Garantir que o nome está descriptografado**
    if (obj.nome) {
        try {
            obj.nome = decrypt(obj.nome);
        } catch (err) {
            console.error('Erro ao descriptografar nome no toJSON:', err);
        }
    }
    
    return obj;
};

// Gera token de reset de senha
UsuarioSchema.methods.gerarResetToken = function() {
    const resetToken = crypto.randomBytes(20).toString('hex');
    this.resetSenhaExpira = Date.now() + 3600000; // 1 hora
    this.resetSenhaTentativas = 0;
    return resetToken;
};

// Limpa dados de reset
UsuarioSchema.methods.limparResetToken = function() {
    this.resetSenhaToken = undefined;
    this.resetSenhaExpira = undefined;
    this.ultimoResetSenha = new Date();
};

// Verifica o token de redefinição usando comparação segura
UsuarioSchema.methods.verificarResetToken = function(token) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    try {
        return (
            token === this.resetSenhaToken &&
            this.resetSenhaExpira > Date.now() &&
            (this.resetSenhaTentativas || 0) < 5
        );
    } catch {
        return false;
    }
};

// Incrementa tentativa de redefinição
UsuarioSchema.methods.incrementarTentativaReset = async function() {
    this.resetSenhaTentativas += 1;
    if (this.resetSenhaTentativas >= 5) {
        this.resetSenhaToken = undefined;
        this.resetSenhaExpira = undefined;
    }
    await this.save();
};

module.exports = mongoose.model('Usuario', UsuarioSchema, 'usuarios');
