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

/** El dispositivo/navegador no soporta la extensión PRF para cifrar con biometría. */
export class PrfUnsupportedError extends Error {
  constructor() {
    super(
      'Tu navegador o dispositivo no soporta biometría para cifrar (PRF). Suele pasar en Chrome de escritorio con Touch ID local. Usa una contraseña maestra.',
    )
    this.name = 'PrfUnsupportedError'
  }
}

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
 * Crea una passkey con la extensión PRF. Solo falla de inmediato si el navegador
 * indica EXPLÍCITAMENTE que PRF no está disponible (`enabled === false`); si es
 * ambiguo (undefined), continuamos y la validación real ocurre en `derivePrfKey`.
 */
export async function createPrfCredential(): Promise<PrfCredential> {
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { name: 'FirmaOK Signer' },
    user: { id: toArrayBuffer(userId), name: 'firmaok-vault', displayName: 'FirmaOK Vault' },
    challenge: toArrayBuffer(challenge),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    // 'platform' + residentKey 'discouraged' enruta al autenticador integrado
    // (Touch ID / Windows Hello) como credencial NO descubrible, reduciendo que
    // un gestor externo (Dashlane/1Password) intercepte la ceremonia.
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'discouraged',
      userVerification: 'required',
    },
    extensions: { prf: {} },
  }
  // `hints: client-device` (WebAuthn L3): pista para preferir el dispositivo local.
  ;(publicKey as unknown as { hints?: string[] }).hints = ['client-device']
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null

  if (!cred) throw new Error('No se pudo crear la passkey.')
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }
  // Solo descartamos si el navegador lo niega explícitamente. Si es undefined,
  // dejamos que `derivePrfKey` (un get real) sea la prueba definitiva.
  if (ext.prf?.enabled === false) {
    throw new PrfUnsupportedError()
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
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: toArrayBuffer(challenge),
    allowCredentials: [{ type: 'public-key', id: toArrayBuffer(credentialId) }],
    userVerification: 'required',
    extensions: { prf: { eval: { first: toArrayBuffer(prfInput) } } },
  }
  ;(publicKey as unknown as { hints?: string[] }).hints = ['client-device']
  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null

  const results = (
    assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  )?.prf?.results?.first
  if (!results) throw new PrfUnsupportedError()

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
