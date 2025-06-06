const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const AuditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true // Agora obrigatório pois só auditamos ações de usuários autenticados
    },
    action: {
        type: String,
        required: true,
        enum: [
            'create',           // Criação bem-sucedida
            'update',           // Atualização bem-sucedida
            'delete',           // Exclusão bem-sucedida
            'login',            // Login bem-sucedido
            'logout',           // Logout bem-sucedido
            'refresh_token',    // Refresh token bem-sucedido
            'upload',           // Upload bem-sucedido
            'password_reset',   // Reset de senha bem-sucedido
            'view',             // Visualização/consulta
            'export',           // Exportação de dados
            'import'            // Importação de dados
        ]
    },
    description: {
        type: String,
        required: true
    },
    collectionName: {
        type: String,
        required: true
    },
    documentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    before: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    after: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    ip: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    tenant_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Tenant',
        required: true
    }
}, {
    timestamps: true,
    versionKey: false
});

// Índices para performance
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ collectionName: 1 });
AuditLogSchema.index({ documentId: 1 });
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ tenant_id: 1 });
AuditLogSchema.index({ action: 1 });

AuditLogSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('AuditLog', AuditLogSchema, 'audit_logs');