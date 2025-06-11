const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
const CertificadoDigital = require('../models/CertificadoDigital');
const { encrypt } = require('../utils/crypto');

class CertificadoDigitalService {
  constructor() {
    // Diretório seguro para armazenar certificados
    this.certificadosDir = path.join(__dirname, '../../storage/certificados');
    this.ensureDirectoryExists();
  }

  async ensureDirectoryExists() {
    try {
      await fs.access(this.certificadosDir);
    } catch {
      await fs.mkdir(this.certificadosDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Analisa um certificado PFX/P12 e extrai informações
   */
  async analisarCertificado(bufferCertificado, senha) {
    try {
      // Converter buffer para base64 para o forge
      const p12Asn1 = forge.asn1.fromDer(bufferCertificado.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

      // Extrair certificado
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const cert = certBags[forge.pki.oids.certBag][0].cert;

      // Extrair chave privada
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
      const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;

      if (!cert || !privateKey) {
        throw new Error('Certificado ou chave privada não encontrados no arquivo');
      }

      // Extrair informações do certificado
      const subject = cert.subject.attributes;
      const issuer = cert.issuer.attributes;
      
      const nomeCompleto = subject.find(attr => attr.name === 'commonName')?.value || 
                          subject.find(attr => attr.shortName === 'CN')?.value || 'Nome não encontrado';
      
      const emissor = issuer.find(attr => attr.name === 'commonName')?.value || 
                     issuer.find(attr => attr.shortName === 'CN')?.value || 'Emissor não encontrado';

      // Gerar fingerprint
      const fingerprint = forge.md.sha256.create();
      fingerprint.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
      
      return {
        valido: true,
        nomeCertificado: nomeCompleto,
        numeroSerie: cert.serialNumber,
        emissor: emissor,
        dataEmissao: cert.validity.notBefore,
        dataVencimento: cert.validity.notAfter,
        fingerprint: fingerprint.digest().toHex().toUpperCase(),
        algoritmoAssinatura: cert.signatureOid,
        tamanhoChave: privateKey.n ? privateKey.n.bitLength() : 2048,
        certificado: cert,
        chavePrivada: privateKey
      };
    } catch (error) {
      console.error('Erro ao analisar certificado');
      throw new Error(`Erro ao analisar certificado`);
    }
  }

  /**
   * Salva o certificado de forma segura no sistema de arquivos
   */
  async salvarCertificadoSeguro(medicoId, bufferCertificado, nomeOriginal) {
    try {
      // Gerar nome único para o arquivo
      const timestamp = Date.now();
      const hash = crypto.createHash('sha256').update(bufferCertificado).digest('hex').substring(0, 16);
      const extensao = path.extname(nomeOriginal) || '.pfx';
      const nomeArquivo = `cert_${medicoId}_${timestamp}_${hash}${extensao}`;
      
      const caminhoCompleto = path.join(this.certificadosDir, nomeArquivo);
      
      // Criptografar o conteúdo do arquivo antes de salvar
      const conteudoCriptografado = encrypt(bufferCertificado.toString('base64'));
      
      await fs.writeFile(caminhoCompleto, conteudoCriptografado, { mode: 0o600 });
      
      return {
        caminhoArquivo: caminhoCompleto,
        nomeArquivo: nomeArquivo,
        caminhoRelativo: `certificados/${nomeArquivo}`
      };
    } catch (error) {
      console.error('Erro ao salvar certificado');
      throw new Error('Erro ao salvar certificado no sistema de arquivos');
    }
  }

  /**
   * Carrega um certificado do sistema de arquivos
   */
  async carregarCertificado(caminhoArquivo) {
    try {
      const { decrypt } = require('../utils/crypto');
      const conteudoCriptografado = await fs.readFile(caminhoArquivo, 'utf8');
      const conteudoDescriptografado = decrypt(conteudoCriptografado);
      return Buffer.from(conteudoDescriptografado, 'base64');
    } catch (error) {
      console.error('Erro ao carregar certificado');
      throw new Error('Erro ao carregar certificado do sistema de arquivos');
    }
  }

  /**
   * Registra um novo certificado para um médico
   */
  async registrarCertificado(medicoId, arquivoCertificado, senha, dadosAdicionais = {}, requestInfo = {}) {
    try {
      // Validar se já existe um certificado ativo para este médico
      const certificadoExistente = await CertificadoDigital.findOne({
        medicoId,
        ativo: true,
        dataVencimento: { $gt: new Date() }
      });

      if (certificadoExistente) {
        throw new Error('Já existe um certificado ativo para este médico. Desative o atual antes de cadastrar um novo.');
      }

      // Analisar o certificado
      const infoCertificado = await this.analisarCertificado(arquivoCertificado.buffer, senha);
      
      // Verificar se o certificado não está vencido
      if (infoCertificado.dataVencimento <= new Date()) {
        throw new Error('O certificado fornecido está vencido');
      }

      // Verificar se o fingerprint já existe
      const certificadoDuplicado = await CertificadoDigital.findOne({
        fingerprint: infoCertificado.fingerprint
      });

      if (certificadoDuplicado) {
        throw new Error('Este certificado já está cadastrado no sistema');
      }

      // Salvar arquivo de forma segura
      const arquivoInfo = await this.salvarCertificadoSeguro(
        medicoId, 
        arquivoCertificado.buffer, 
        arquivoCertificado.originalname
      );

      // Criar registro no banco
      const bcrypt = require('bcryptjs');
      const senhaHash = await bcrypt.hash(senha, 10);
      
      const novoCertificado = new CertificadoDigital({
        medicoId,
        nomeCertificado: infoCertificado.nomeCertificado,
        numeroSerie: infoCertificado.numeroSerie,
        emissor: infoCertificado.emissor,
        dataEmissao: infoCertificado.dataEmissao,
        dataVencimento: infoCertificado.dataVencimento,
        arquivoCertificado: arquivoInfo.caminhoRelativo,
        senhaCertificado: senha,  // Senha original criptografada
        senhaHash: senhaHash,     // Hash da senha para validação
        fingerprint: infoCertificado.fingerprint,
        algoritmoAssinatura: infoCertificado.algoritmoAssinatura,
        tamanhoChave: infoCertificado.tamanhoChave,
        validado: true, // Validação automática por análise bem-sucedida
        criadoPor: medicoId,
        ipCriacao: requestInfo.ip,
        userAgentCriacao: requestInfo.userAgent,
        ...dadosAdicionais
      });

      await novoCertificado.save();

      return {
        sucesso: true,
        certificadoId: novoCertificado._id,
        informacoes: {
          nome: infoCertificado.nomeCertificado,
          emissor: infoCertificado.emissor,
          dataVencimento: infoCertificado.dataVencimento,
          diasVencimento: novoCertificado.diasVencimento,
          status: novoCertificado.status
        }
      };
    } catch (error) {
      console.error('Erro ao registrar certificado');
      throw error;
    }
  }

  /**
   * Obtém o certificado ativo de um médico para assinatura
   */
  async obterCertificadoParaAssinatura(medicoId) {
    try {
      const certificado = await CertificadoDigital.findOne({
        medicoId,
        ativo: true,
        dataVencimento: { $gt: new Date() }
      }).populate('medicoId', 'nome crm');

      if (!certificado) {
        throw new Error('Nenhum certificado ativo encontrado para este médico');
      }

      if (certificado.estaVencido()) {
        throw new Error('O certificado está vencido');
      }

      // Carregar arquivo do certificado
      const bufferCertificado = await this.carregarCertificado(
        path.join(this.certificadosDir, path.basename(certificado.arquivoCertificado))
      );

      return {
        certificadoId: certificado._id,
        bufferCertificado,
        senha: certificado.senhaCertificado, // Retorna o hash para verificação
        informacoes: {
          nome: certificado.nomeCertificado,
          emissor: certificado.emissor,
          dataVencimento: certificado.dataVencimento,
          medico: certificado.medicoId.nome
        }
      };
    } catch (error) {
      console.error('Erro ao obter certificado para assinatura');
      throw error;
    }
  }

  /**
   * Valida um certificado e senha antes do uso
   */
  async validarCertificadoParaUso(certificadoId, senhaFornecida) {
    try {
      const certificado = await CertificadoDigital.findById(certificadoId);
      
      if (!certificado) {
        throw new Error('Certificado não encontrado');
      }

      if (!certificado.ativo) {
        throw new Error('Certificado inativo');
      }

      if (certificado.estaVencido()) {
        throw new Error('Certificado vencido');
      }

      if (!(await certificado.validarSenha(senhaFornecida))) {
        await certificado.registrarUso(false, null, 'Senha incorreta');
        throw new Error('Senha do certificado incorreta');
      }

      return true;
    } catch (error) {
      console.error('Erro ao validar certificado');
      throw error;
    }
  }

  /**
   * Remove um certificado (desativa e remove arquivo)
   */
  async removerCertificado(certificadoId, medicoId) {
    try {
      const certificado = await CertificadoDigital.findOne({
        _id: certificadoId,
        medicoId
      });

      if (!certificado) {
        throw new Error('Certificado não encontrado');
      }

      // Desativar no banco
      certificado.ativo = false;
      await certificado.save();

      // Remover arquivo físico
      try {
        const caminhoArquivo = path.join(this.certificadosDir, path.basename(certificado.arquivoCertificado));
        await fs.unlink(caminhoArquivo);
      } catch (error) {
        console.warn('Erro ao remover arquivo do certificado');
      }

      return { sucesso: true };
    } catch (error) {
      console.error('Erro ao remover certificado');
      throw error;
    }
  }

  /**
   * Lista certificados de um médico
   */
  async listarCertificadosMedico(medicoId, incluirInativos = false) {
    try {
      const filtro = { medicoId };
      
      if (!incluirInativos) {
        filtro.ativo = true;
      }

      const certificados = await CertificadoDigital.find(filtro)
        .select('-senhaCertificado -arquivoCertificado -tentativasUso')
        .sort({ createdAt: -1 });

      return certificados.map(cert => ({
        id: cert._id,
        nomeCertificado: cert.nomeCertificado,
        emissor: cert.emissor,
        dataEmissao: cert.dataEmissao,
        dataVencimento: cert.dataVencimento,
        status: cert.status,
        diasVencimento: cert.diasVencimento,
        totalAssinaturas: cert.totalAssinaturas,
        ultimoUso: cert.ultimoUso,
        proximoVencimento: cert.proximoVencimento(),
        createdAt: cert.createdAt
      }));
    } catch (error) {
      console.error('Erro ao listar certificados');
      throw error;
    }
  }

  /**
   * Verifica certificados próximos do vencimento
   */
  async verificarVencimentosCertificados(diasAviso = 30) {
    try {
      const dataLimite = new Date();
      dataLimite.setDate(dataLimite.getDate() + diasAviso);

      const certificados = await CertificadoDigital.find({
        ativo: true,
        dataVencimento: {
          $gte: new Date(),
          $lte: dataLimite
        }
      }).populate('medicoId', 'nome email');

      return certificados.map(cert => ({
        certificadoId: cert._id,
        medico: {
          id: cert.medicoId._id,
          nome: cert.medicoId.nome,
          email: cert.medicoId.email
        },
        nomeCertificado: cert.nomeCertificado,
        dataVencimento: cert.dataVencimento,
        diasRestantes: cert.diasVencimento
      }));
    } catch (error) {
      console.error('Erro ao verificar vencimentos');
      throw error;
    }
  }
}

module.exports = new CertificadoDigitalService();
