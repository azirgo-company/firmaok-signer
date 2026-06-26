import '@testing-library/jest-dom/vitest'

// jsdom no trae WebCrypto SubtleCrypto completo; usamos el de Node (globalThis.crypto)
// que sí soporta importKey/sign/encrypt para los tests del núcleo criptográfico.
if (!globalThis.crypto?.subtle) {
  // Node 22 expone webcrypto en globalThis.crypto por defecto; este guard es por si acaso.
  const { webcrypto } = await import('node:crypto')
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
