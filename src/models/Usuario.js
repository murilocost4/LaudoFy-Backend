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
    // Array de roles adicionais - permite múltiplas permissões
    roles: {
        type: [String],
        enum: ['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'],
        default: []
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
    // Tenants onde o usuário tem privilégios de admin
    admin_tenants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }],
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
    
    // Adicionar informações de roles
    obj.todasRoles = this.todasRoles;
    obj.rolesPrincipais = {
        principal: this.role,
        adicionais: this.roles || [],
        todas: this.todasRoles
    };
    
    // Adicionar informações de tenants admin
    obj.tenantsAdmin = this.getTenantsAdmin();
    obj.isAdminDoTenant = (tenantId) => this.isAdminDoTenant(tenantId);
    
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

// Virtual para obter todas as roles do usuário (role principal + roles adicionais)
UsuarioSchema.virtual('todasRoles').get(function() {
    const roles = new Set([this.role]); // Começar com a role principal
    
    // Adicionar roles adicionais se existirem
    if (this.roles && Array.isArray(this.roles)) {
        this.roles.forEach(role => roles.add(role));
    }
    
    // Se é AdminMaster, adicionar todas as permissões
    if (this.isAdminMaster) {
        roles.add('adminMaster');
        roles.add('admin');
        roles.add('medico');
        roles.add('tecnico');
        roles.add('recepcionista');
    }
    
    return Array.from(roles);
});

// Método para verificar se o usuário tem uma role específica
UsuarioSchema.methods.temRole = function(roleVerificar) {
    return this.todasRoles.includes(roleVerificar);
};

// Método para verificar se o usuário tem pelo menos uma das roles
UsuarioSchema.methods.temAlgumaRole = function(rolesVerificar) {
    if (!Array.isArray(rolesVerificar)) {
        rolesVerificar = [rolesVerificar];
    }
    return rolesVerificar.some(role => this.temRole(role));
};

// Método para adicionar uma role adicional
UsuarioSchema.methods.adicionarRole = function(novaRole) {
    const rolesValidas = ['medico', 'tecnico', 'admin', 'adminMaster', 'recepcionista'];
    
    if (!rolesValidas.includes(novaRole)) {
        throw new Error('Role inválida');
    }
    
    if (!this.roles) {
        this.roles = [];
    }
    
    // Não adicionar se já é a role principal ou se já existe nas roles adicionais
    if (this.role !== novaRole && !this.roles.includes(novaRole)) {
        this.roles.push(novaRole);
    }
};

// Método para remover uma role adicional
UsuarioSchema.methods.removerRole = function(roleRemover) {
    if (this.role === roleRemover) {
        throw new Error('Não é possível remover a role principal. Altere a role principal primeiro.');
    }
    
    if (this.roles && Array.isArray(this.roles)) {
        this.roles = this.roles.filter(role => role !== roleRemover);
    }
};

// Método para verificar se o usuário é admin de um tenant específico
UsuarioSchema.methods.isAdminDoTenant = function(tenantId) {
    if (this.isAdminMaster) return true; // AdminMaster tem acesso a tudo
    
    if (!this.admin_tenants || !Array.isArray(this.admin_tenants)) return false;
    
    return this.admin_tenants.some(adminTenant => 
        adminTenant.toString() === tenantId.toString()
    );
};

// Método para obter tenants onde o usuário é admin
UsuarioSchema.methods.getTenantsAdmin = function() {
    if (this.isAdminMaster) {
        return this.tenant_id; // AdminMaster é admin de todos os tenants que tem acesso
    }
    return this.admin_tenants || [];
};

// Método para adicionar tenant admin
UsuarioSchema.methods.adicionarTenantAdmin = function(tenantId) {
    if (!this.admin_tenants) {
        this.admin_tenants = [];
    }
    
    // Verificar se o usuário tem acesso ao tenant
    const temAcesso = this.tenant_id.some(tenant => 
        tenant.toString() === tenantId.toString()
    );
    
    if (!temAcesso) {
        throw new Error('Usuário não tem acesso a este tenant');
    }
    
    // Adicionar se não existir
    const jaEAdmin = this.admin_tenants.some(adminTenant => 
        adminTenant.toString() === tenantId.toString()
    );
    
    if (!jaEAdmin) {
        this.admin_tenants.push(tenantId);
    }
};

// Método para remover tenant admin
UsuarioSchema.methods.removerTenantAdmin = function(tenantId) {
    if (this.admin_tenants && Array.isArray(this.admin_tenants)) {
        this.admin_tenants = this.admin_tenants.filter(adminTenant => 
            adminTenant.toString() !== tenantId.toString()
        );
    }
};

module.exports = mongoose.model('Usuario', UsuarioSchema, 'usuarios');
