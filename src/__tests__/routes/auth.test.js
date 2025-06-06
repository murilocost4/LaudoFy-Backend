const request = require('supertest');
const { app } = require('../../../server'); // Importa o app Express
const Usuario = require('../../models/Usuario');

describe('Rota de Registro', () => {
    beforeEach(async () => {
        // Limpa a coleção de usuários antes de cada teste
        await Usuario.deleteMany({});
    });

    it('deve registrar um novo usuário', async () => {
        const response = await request(app)
            .post('/api/auth/registrar')
            .send({
                nome: 'Dr. João Silva',
                email: 'joao.silva.teste2@example.com',
                senha: 'senha123',
                role: 'medico',
            });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('accessToken');
        expect(response.body).toHaveProperty('refreshToken');

        // Verifica se o usuário foi salvo no banco de dados
        const usuario = await Usuario.findOne({ email: 'joao.silva.teste2@example.com' });
        expect(usuario).not.toBeNull();
    });

    it('não deve registrar um usuário com email duplicado', async () => {
        // Cria um usuário inicial
        await request(app)
            .post('/api/auth/registrar')
            .send({
                nome: 'Dr. João Silva',
                email: 'joao.silva.teste2@example.com',
                senha: 'senha123',
                role: 'medico',
            });

        // Tenta criar outro usuário com o mesmo email
        const response = await request(app)
            .post('/api/auth/registrar')
            .send({
                nome: 'Dr. João Silva',
                email: 'joao.silva.teste2@example.com',
                senha: 'senha123',
                role: 'medico',
            });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('erro', 'Email já cadastrado');
    });
});