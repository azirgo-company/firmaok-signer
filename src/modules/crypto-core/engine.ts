import * as pkijs from 'pkijs'

let configured = false

/**
 * Asegura que PKI.js use WebCrypto (`globalThis.crypto`) tanto en navegador como en Node.
 * Idempotente: solo configura el engine una vez.
 */
export function ensureCryptoEngine(): void {
  if (configured) return
  const cryptoImpl = globalThis.crypto
  if (!cryptoImpl?.subtle) {
    throw new Error('WebCrypto (crypto.subtle) no está disponible en este entorno.')
  }
  const engine = new pkijs.CryptoEngine({ name: 'firmaok', crypto: cryptoImpl as Crypto })
  // El tipo de WebCrypto en TS 6 difiere del esperado por PKI.js (Ed25519/X25519);
  // en runtime es compatible para las operaciones RSA/SHA que usamos.
  pkijs.setEngine('firmaok', engine as unknown as pkijs.ICryptoEngine)
  configured = true
}
