const crypto = require('crypto');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente
dotenv.config();

// Verificação rigorosa da chave
const CRYPTO_SECRET = process.env.CRYPTO_SECRET;
if (!CRYPTO_SECRET) {
  throw new Error('CRYPTO_SECRET não está definido no arquivo .env');
}

// Configurações de criptografia
const algorithm = 'aes-256-cbc';
const keyLength = 32;
const ivLength = 16;
const salt = 'fixed_salt_value_do_not_change_this'; // IMPORTANTE: Nunca mude este valor

// Deriva a chave de forma segura
const key = crypto.scryptSync(CRYPTO_SECRET, salt, keyLength);

function encrypt(text) {
  if (text === null || text === undefined) return null;
  
  try {
    const textString = String(text);
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(textString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('Erro na criptografia:', err.message);
    return null;
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  if (typeof encryptedText !== 'string') return encryptedText;
  
  // Verifica se o texto está no formato IV:DadosCriptografados
  const parts = encryptedText.split(':');
  if (parts.length !== 2 || parts[0].length !== ivLength * 2) {
    return encryptedText; // Retorna original se não estiver no formato esperado
  }

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Falha na descriptografia:', {
      error: err.message,
      input: encryptedText.length > 50 
        ? encryptedText.substring(0, 50) + '...' 
        : encryptedText
    });
    
    // Retorna null para dados corrompidos/inválidos
    return null;
  }
}

module.exports = { encrypt, decrypt };