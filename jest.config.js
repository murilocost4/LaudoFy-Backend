module.exports = {
    testEnvironment: 'node', // Ambiente de teste (Node.js)
    coverageDirectory: 'coverage', // Pasta para relatórios de cobertura
    collectCoverageFrom: ['src/**/*.js'], // Arquivos a serem incluídos na cobertura
    testMatch: ['**/__tests__/**/*.test.js'], // Padrão para encontrar arquivos de teste
};