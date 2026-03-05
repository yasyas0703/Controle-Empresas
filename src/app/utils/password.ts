const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*+-_=';
const DEFAULT_PASSWORD_LENGTH = 16;

type CryptoWithRandomValues = Pick<Crypto, 'getRandomValues'>;

function getCrypto(): CryptoWithRandomValues {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto;
  }
  throw new Error('API de criptografia indisponivel para gerar senha segura.');
}

export function gerarSenhaSegura(length = DEFAULT_PASSWORD_LENGTH): string {
  const size = Number.isFinite(length) ? Math.max(8, Math.floor(length)) : DEFAULT_PASSWORD_LENGTH;
  const bytes = new Uint32Array(size);
  getCrypto().getRandomValues(bytes);

  let senha = '';
  for (let i = 0; i < size; i += 1) {
    senha += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  }
  return senha;
}
