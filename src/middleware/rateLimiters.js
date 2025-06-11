const rateLimit = require('express-rate-limit');

exports.limiterLogin = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos em milissegundos
    max: 5,
    message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

exports.limiterRegistro = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { erro: 'Muitas tentativas de registro. Tente novamente mais tarde.' }
});

exports.limiterEsqueciSenha = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { erro: 'Muitas tentativas de recuperação de senha. Aguarde.' }
});

exports.limiterRefresh = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { erro: 'Excesso de requisições. Aguarde.' }
});
