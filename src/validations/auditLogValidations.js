const { query, param } = require('express-validator');

exports.validarListagem = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isString(),
    query('action').optional().isString(),
    query('collectionName').optional().isString(),
    query('userId').optional().isMongoId(),
    query('documentId').optional().isMongoId(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('status').optional().isString()
];

exports.validarDetalhes = [
    param('id').isMongoId().withMessage('ID inválido')
];