import { argon2id } from 'hash-wasm'
import { toArrayBuffer } from '../../lib/bytes'

// Cifrado en reposo con una clave AES-256-GCM derivada de la contraseña maestra
// mediante Argon2id (memory-hard). La clave AES nunca se persiste: se re-deriva.

/** Parámetros de Argon2id. memorySize en KB. */
export interface ArgonParams {
  memorySize: number
  iterations: number
  parallelism: number
}

// 64 MB, 3 pasadas: memory-hard, frena fuerza bruta por GPU; aceptable en móvil.
export const DEFAULT_ARGON_PARAMS: ArgonParams = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 1,
}

export interface EncryptedBlob {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, toArrayBuffer(plaintext))
  return { iv, ciphertext: new Uint8Array(ct) }
}

export async function aesDecrypt(key: CryptoKey, blob: EncryptedBlob): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(blob.iv) },
    key,
    toArrayBuffer(blob.ciphertext),
  )
  return new Uint8Array(pt)
}

/** Deriva la clave AES-256-GCM desde la contraseña maestra con Argon2id (WASM). */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: ArgonParams = DEFAULT_ARGON_PARAMS,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: 32,
    outputType: 'binary',
  })
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
