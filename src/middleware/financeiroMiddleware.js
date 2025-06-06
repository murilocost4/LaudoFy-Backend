/**
 * Middleware para verificar se o usuário tem permissão para acessar funcionalidades financeiras
 * Verifica se o usuário possui o campo permissaoFinanceiro como true
 * ou se o usuário é um adminMaster (que sempre tem acesso total)
 */
const verificarPermissaoFinanceiro = (req, res, next) => {
    // Se o usuário não estiver autenticado
    if (!req.usuario) {
        return res.status(401).json({ erro: 'Usuário não autenticado' });
    }

    // Verificar se o usuário é adminMaster ou tem permissão de financeiro
    if (req.usuario.isAdminMaster || req.usuario.permissaoFinanceiro) {
        return next();
    }

    // Se o usuário não tiver permissão
    return res.status(403).json({ 
        erro: 'Acesso negado', 
        mensagem: 'Você não possui permissão para acessar funcionalidades financeiras' 
    });
};

module.exports = { verificarPermissaoFinanceiro };
