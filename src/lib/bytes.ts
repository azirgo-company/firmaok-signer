// Utilidades de conversión de bytes/codificación, sin dependencias de Node (Buffer-free).
// Todo trabaja con Uint8Array/ArrayBuffer para máxima portabilidad en navegador.

/** Convierte una "binary string" (cada char = 1 byte, estilo node-forge) a Uint8Array. */
export function binaryStringToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
  return out
}

/** Convierte Uint8Array a "binary string" (para alimentar a node-forge). */
export function bytesToBinaryString(bytes: Uint8Array): string {
  let s = ''
  // Por bloques para no reventar el stack con String.fromCharCode(...spread).
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return s
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes))
}

export function base64ToBytes(b64: string): Uint8Array {
  return binaryStringToBytes(atob(b64))
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Compara dos arrays de bytes en tiempo (aprox.) constante. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Vista ArrayBuffer estricta (evita el caso de Uint8Array con offset/length parcial). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
