const { gerarTokens } = require('../controllers/authController');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config()

describe('Função gerarTokens', () => {
    it('deve gerar um access token e um refresh token', () => {
        const usuario = { _id: '123', role: 'medico' };
        const tokens = gerarTokens(usuario);

        expect(tokens).toHaveProperty('accessToken');
        expect(tokens).toHaveProperty('refreshToken');

        // Verifica se os tokens são válidos
        const accessTokenDecoded = jwt.verify(tokens.accessToken, process.env.JWT_SECRET);
        const refreshTokenDecoded = jwt.verify(tokens.refreshToken, process.env.JWT_REFRESH_SECRET);

        expect(accessTokenDecoded.id).toBe(usuario._id);
        expect(accessTokenDecoded.role).toBe(usuario.role);
        expect(refreshTokenDecoded.id).toBe(usuario._id);
    });
});