const Usuario = require('../models/Usuario');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');

class AuthService {
    static async solicitarResetSenha(email) {
        try {
            const usuario = await Usuario.findOne({ email }).select('+resetSenhaToken +resetSenhaExpira');
            if (!usuario) {
                logger.debug(`Tentativa de reset de senha para email não cadastrado: ${email}`);
                return null;
            }

            // Limpa tokens anteriores se existirem
            if (usuario.resetSenhaToken) {
                usuario.limparResetToken();
                await usuario.save();
            }

            const resetToken = usuario.gerarResetToken();
            await usuario.save();

            logger.info(`Token de reset gerado para usuário: ${usuario._id}`);
            
            return {
                resetToken,
                usuario: usuario.toJSON()
            };
        } catch (error) {
            logger.error(`Erro ao solicitar reset de senha: ${error.message}`, { email });
            throw new Error('Falha ao processar solicitação de reset de senha');
        }
    }

    /**
     * Realiza o reset de senha com validações robustas
     * @param {String} token - Token de reset
     * @param {String} novaSenha - Nova senha
     * @returns {Usuario} usuário atualizado
     * @throws {Error} Se o token for inválido, expirado ou outras falhas ocorrerem
     */
    static async resetarSenha(token, novaSenha) {
        if (!token || !novaSenha) {
            throw new Error('Token e nova senha são obrigatórios');
        }

        logger.info(`Iniciando processo de reset de senha com token: ${token.substring(0, 10)}...`);

        try {
            const usuario = await Usuario.findOne({
                resetSenhaToken: { $exists: true },
                resetSenhaExpira: { $gt: Date.now() }
            }).select('+senha +resetSenhaToken +resetSenhaExpira +resetSenhaTentativas');

            if (!usuario) {
                logger.warn('Tentativa de reset com token inválido ou expirado');
                throw new Error('Token inválido ou expirado');
            }

            logger.debug(`Usuário encontrado para reset: ${usuario.email}`, {
                tokenExpira: usuario.resetSenhaExpira,
                tentativas: usuario.resetSenhaTentativas
            });

            // Verifica se o token é válido
            const tokenValido = usuario.verificarResetToken(token);
            if (!tokenValido) {
                await usuario.incrementarTentativaReset();
                logger.warn(`Token inválido para usuário ${usuario.email}. Tentativa ${usuario.resetSenhaTentativas}`);
                throw new Error('Token inválido');
            }

            // Verifica se a nova senha é diferente da atual
            const isSamePassword = await bcrypt.compare(novaSenha, usuario.senha);
            if (isSamePassword) {
                throw new Error('A nova senha deve ser diferente da senha atual');
            }

            // Atualiza a senha e limpa o token
            usuario.senha = novaSenha;
            usuario.limparResetToken();
            await usuario.save();

            logger.info(`Senha resetada com sucesso para usuário: ${usuario.email}`);
            return usuario;
            
        } catch (error) {
            logger.error(`Falha no reset de senha: ${error.message}`, { error });
            throw error;
        }
    }

    /**
     * Verifica se um token de reset é válido
     * @param {String} token - Token a ser verificado
     * @returns {Boolean} true se válido, false caso contrário
     */
    static async verificarTokenReset(token) {
        if (!token) return false;

        try {
            const usuario = await Usuario.findOne({
                resetSenhaToken: { $exists: true },
                resetSenhaExpira: { $gt: Date.now() }
            }).select('+resetSenhaToken +resetSenhaExpira');

            if (!usuario) {
                logger.debug('Token não encontrado ou expirado');
                return false;
            }

            return usuario.verificarResetToken(token);
        } catch (error) {
            logger.error(`Erro ao verificar token: ${error.message}`);
            return false;
        }
    }

    /**
     * Limpa tokens de reset expirados
     * @returns {Number} Número de usuários atualizados
     */
    static async limparTokensExpirados() {
        try {
            const result = await Usuario.updateMany(
                { 
                    resetSenhaExpira: { $lt: new Date() } 
                },
                { 
                    $unset: { 
                        resetSenhaToken: 1,
                        resetSenhaExpira: 1 
                    },
                    $set: { 
                        resetSenhaTentativas: 0 
                    }
                }
            );
            
            logger.info(`Tokens expirados limpos: ${result.modifiedCount} usuários`);
            return result.modifiedCount;
        } catch (error) {
            logger.error(`Falha ao limpar tokens expirados: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AuthService;