// utils/helpers.js
const { decrypt } = require('./crypto');

// Mascara dados sensíveis
// utils/helpers.js
exports.maskSensitiveData = (data, fieldsToMask) => {
    const masked = {...data};
    fieldsToMask.forEach(field => {
        if (masked[field]) {
            if (field === 'cpf' && masked[field].length === 11) {
                // Formato: ***.***.***-XX
                masked[field] = `***.***.${masked[field].slice(-4)}`;
            } else if (field === 'telefone' && masked[field].length >= 10) {
                // Formato: (**) ****-XXXX
                const ddd = masked[field].length === 11 ? masked[field].slice(0, 2) : '**';
                const final = masked[field].slice(-4);
                masked[field] = `(${ddd}) ****-${final}`;
            } else if (field === 'email') {
                // Mantém o domínio visível: a***@dominio.com
                const [user, domain] = masked[field].split('@');
                masked[field] = `${user[0]}***@${domain}`;
            } else {
                masked[field] = '*****';
            }
        }
    });
    return masked;
}

// Descriptografa campos do paciente
exports.decryptPaciente = (paciente) => {
    const decrypted = {...paciente.toObject ? paciente.toObject() : paciente};
    
    // Campos que serão automaticamente descriptografados pelos getters do schema
    return {
        ...decrypted,
        // Adicione aqui qualquer campo adicional que precise de tratamento especial
    };
};