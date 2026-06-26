import { argon2id } from 'hash-wasm'
import { toArrayBuffer } from '../../lib/bytes'

// Deriva una clave AES-256-GCM de cifrado en reposo a partir de:
//  - Biometría/passkey del dispositivo (WebAuthn PRF), o
//  - Una contraseña maestra elegida por el usuario (Argon2id, memory-hard).
// La clave AES nunca se persiste: se re-deriva en cada desbloqueo.

export type ProtectionMethod = 'webauthn-prf' | 'pin'
export type Kdf = 'argon2id' | 'pbkdf2'

const PBKDF2_ITERATIONS = 600_000 // solo para leer registros legacy
const APP_PRF_LABEL = new TextEncoder().encode('firmaok-signer/prf/v1')

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

// ---------- AES-GCM en reposo ----------

export interface EncryptedBlob {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    toArrayBuffer(plaintext),
  )
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

// ---------- Contraseña maestra (Argon2id, memory-hard) ----------

/** Deriva la clave AES-256-GCM desde la contraseña maestra con Argon2id (WASM). */
export async function derivePinKey(
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
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** Derivación PBKDF2 legacy: solo para descifrar registros antiguos. */
export async function derivePinKeyPbkdf2(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---------- Biometría / passkey (WebAuthn PRF) ----------

export function isWebAuthnPrfSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  )
}

export interface PrfCredential {
  credentialId: Uint8Array
}

/**
 * Crea una passkey ligada al dispositivo con la extensión PRF habilitada.
 * Requiere verificación del usuario (biometría / PIN del SO).
 */
export async function createPrfCredential(): Promise<PrfCredential> {
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'FirmaOK Signer' },
      user: { id: toArrayBuffer(userId), name: 'firmaok-vault', displayName: 'FirmaOK Vault' },
      challenge: toArrayBuffer(challenge),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null

  if (!cred) throw new Error('No se pudo crear la passkey.')
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }
  if (!ext.prf?.enabled) {
    throw new Error('Este dispositivo/navegador no soporta PRF para cifrar con biometría.')
  }
  return { credentialId: new Uint8Array(cred.rawId) }
}

/**
 * Re-deriva la clave AES-GCM autenticándose con la passkey y el secreto PRF.
 * `vaultSalt` separa el secreto por bóveda; se combina con un label fijo de la app.
 */
export async function derivePrfKey(
  credentialId: Uint8Array,
  vaultSalt: Uint8Array,
): Promise<CryptoKey> {
  const prfInput = await sha256(concat(APP_PRF_LABEL, vaultSalt))
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      allowCredentials: [{ type: 'public-key', id: toArrayBuffer(credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: toArrayBuffer(prfInput) } } },
    },
  })) as PublicKeyCredential | null

  const results = (
    assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  )?.prf?.results?.first
  if (!results) throw new Error('No se obtuvo el secreto biométrico (PRF).')

  // El secreto PRF se usa como material para HKDF -> clave AES-GCM.
  const ikm = await crypto.subtle.importKey('raw', results, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(vaultSalt),
      info: APP_PRF_LABEL as BufferSource,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(data)))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
