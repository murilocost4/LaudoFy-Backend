const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const ExameSchema = new mongoose.Schema({
    paciente: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Paciente',
        required: true,
    },
    tipoExame: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TipoExame',
        required: true
    },
    dataExame: {
        type: Date,
        default: Date.now,
    },
    arquivo: {
        type: String,
        required: true,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                return decrypt(v);
            } catch (error) {
                console.error('Erro ao descriptografar arquivo:', error);
                return '';
            }
        }
    },
    arquivoKey: {
        type: String,
        required: false, // Opcional para manter compatibilidade com dados existentes
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                return decrypt(v);
            } catch (error) {
                console.error('Erro ao descriptografar arquivoKey:', error);
                return '';
            }
        }
    },
    observacoes: {
        type: String,
        required: true,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                return decrypt(v);
            } catch (error) {
                console.error('Erro ao descriptografar observações:', error);
                return '';
            }
        }
    },
    // **RESTAURADO: Campo status com getters/setters originais**
    status: {
        type: String,
        default: 'Pendente',
        // REMOVIDO: enum aqui para evitar conflito
        validate: {
            validator: function(value) {
                // Se o valor já está criptografado (contém ':'), aceitar
                if (typeof value === 'string' && value.includes(':')) {
                    return true;
                }
                // Se não está criptografado, validar se é um dos valores permitidos
                const valoresPermitidos = ['Pendente', 'Concluído', 'Laudo realizado', 'Cancelado'];
                return valoresPermitidos.includes(value);
            },
            message: function(props) {
                // Se o valor contém ':', foi criptografado e passou na validação
                if (typeof props.value === 'string' && props.value.includes(':')) {
                    return 'Status criptografado válido';
                }
                return `${props.value} não é um status válido. Valores permitidos: Pendente, Concluído, Laudo realizado, Cancelado`;
            }
        },
        set: function(v) {
            // Se já está criptografado, retornar como está
            if (typeof v === 'string' && v.includes(':')) {
                return v;
            }
            // Se é um valor válido, criptografar
            if (v && typeof v === 'string') {
                return encrypt(v.trim());
            }
            return v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                // Se contém ':', está criptografado
                if (typeof v === 'string' && v.includes(':')) {
                    return decrypt(v);
                }
                return v;
            } catch (error) {
                console.error('Erro ao descriptografar status:', error);
                return 'Pendente';
            }
        }
    },
    // Campos numéricos com criptografia
    segmentoPR: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar segmentoPR:', error);
                return v;
            }
        }
    },
    frequenciaCardiaca: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar frequenciaCardiaca:', error);
                return v;
            }
        }
    },
    duracaoQRS: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar duracaoQRS:', error);
                return v;
            }
        }
    },
    eixoMedioQRS: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar eixoMedioQRS:', error);
                return v;
            }
        }
    },
    altura: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar altura:', error);
                return v;
            }
        }
    },
    peso: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseFloat(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar peso:', error);
                return v;
            }
        }
    },
    idade: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                const decrypted = decrypt(v);
                return decrypted ? parseInt(decrypted) : v;
            } catch (error) {
                console.error('Erro ao descriptografar idade:', error);
                return v;
            }
        }
    },
    tecnico: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: false,
    },
    thumbnail: {
        type: String,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            if (!v) return v;
            try {
                return decrypt(v);
            } catch (error) {
                console.error('Erro ao descriptografar thumbnail:', error);
                return '';
            }
        }
    },
    tenant_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Tenant',
        required: true
    }
}, { 
    timestamps: true,
    toJSON: { 
        getters: true, 
        virtuals: true
    },
    toObject: { 
        getters: true, 
        virtuals: true 
    }
});

// Ensure indexes for better query performance
ExameSchema.index({ tenant_id: 1 });
ExameSchema.index({ paciente: 1 });
ExameSchema.index({ tipoExame: 1 });
ExameSchema.index({ status: 1 });
ExameSchema.index({ dataExame: -1 });

module.exports = mongoose.model('Exame', ExameSchema);