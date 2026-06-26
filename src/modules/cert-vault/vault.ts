import { openDB, type IDBPDatabase } from 'idb'
import { base64ToBytes, bytesToBase64, toArrayBuffer } from '../../lib/bytes'
import { parseP12, type CertSubject } from './p12'
import {
  aesDecrypt,
  aesEncrypt,
  createPrfCredential,
  derivePinKey,
  derivePrfKey,
  isWebAuthnPrfSupported,
  type EncryptedBlob,
  type ProtectionMethod,
} from './key-protection'

const DB_NAME = 'firmaok-vault'
const STORE = 'vault'
const RECORD_KEY = 'default'

interface StoredEncryptedBlob {
  iv: string
  ct: string
}

interface VaultRecord {
  method: ProtectionMethod
  vaultSalt: string
  pinSalt?: string
  credentialId?: string
  encKey: StoredEncryptedBlob // PKCS#8 cifrado
  encMeta: StoredEncryptedBlob // metadatos cifrados (datos personales)
  createdAt: number
}

interface CertMetadata {
  leafCertDer: string
  chainDer: string[]
  subject: CertSubject
  validFrom: string
  validTo: string
}

/** Certificado descifrado y listo para firmar en la sesión actual (solo en memoria). */
export interface UnlockedVault {
  /** Clave de firma NO extraíble: solo vive en memoria, no se puede exportar. */
  signingKey: CryptoKey
  leafCertDer: Uint8Array
  chainDer: Uint8Array[]
  subject: CertSubject
  validFrom: Date
  validTo: Date
}

export interface ImportOptions {
  password?: string
  method: ProtectionMethod
  /** PIN requerido cuando method === 'pin'. */
  pin?: string
}

function blobToStored(b: EncryptedBlob): StoredEncryptedBlob {
  return { iv: bytesToBase64(b.iv), ct: bytesToBase64(b.ciphertext) }
}
function storedToBlob(s: StoredEncryptedBlob): EncryptedBlob {
  return { iv: base64ToBytes(s.iv), ciphertext: base64ToBytes(s.ct) }
}

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    },
  })
}

export async function hasStoredCertificate(): Promise<boolean> {
  const record = await (await db()).get(STORE, RECORD_KEY)
  return Boolean(record)
}

export async function getStoredMethod(): Promise<ProtectionMethod | null> {
  const record = (await (await db()).get(STORE, RECORD_KEY)) as VaultRecord | undefined
  return record?.method ?? null
}

/**
 * Importa un .p12 UNA sola vez: parsea, cifra la clave PKCS#8 y los metadatos con una
 * clave derivada de biometría (PRF) o PIN, y los guarda en IndexedDB. La contraseña del
 * .p12 no se persiste: a partir de aquí se desbloquea con biometría/PIN.
 */
export async function importP12(p12Bytes: Uint8Array, opts: ImportOptions): Promise<UnlockedVault> {
  const parsed = parseP12(p12Bytes, opts.password ?? '')

  const vaultSalt = crypto.getRandomValues(new Uint8Array(16))
  let protectionKey: CryptoKey
  const record: Partial<VaultRecord> = { method: opts.method, vaultSalt: bytesToBase64(vaultSalt) }

  if (opts.method === 'webauthn-prf') {
    if (!isWebAuthnPrfSupported()) {
      throw new Error('Este navegador no soporta biometría (WebAuthn). Usa un PIN.')
    }
    const cred = await createPrfCredential()
    record.credentialId = bytesToBase64(cred.credentialId)
    protectionKey = await derivePrfKey(cred.credentialId, vaultSalt)
  } else {
    if (!opts.pin || opts.pin.length < 6) {
      throw new Error('El PIN debe tener al menos 6 caracteres.')
    }
    const pinSalt = crypto.getRandomValues(new Uint8Array(16))
    record.pinSalt = bytesToBase64(pinSalt)
    protectionKey = await derivePinKey(opts.pin, pinSalt)
  }

  const metadata: CertMetadata = {
    leafCertDer: bytesToBase64(parsed.leafCertDer),
    chainDer: parsed.chainDer.map(bytesToBase64),
    subject: parsed.subject,
    validFrom: parsed.validFrom.toISOString(),
    validTo: parsed.validTo.toISOString(),
  }

  const encKey = await aesEncrypt(protectionKey, parsed.privateKeyPkcs8)
  const encMeta = await aesEncrypt(
    protectionKey,
    new TextEncoder().encode(JSON.stringify(metadata)),
  )

  const full: VaultRecord = {
    method: opts.method,
    vaultSalt: bytesToBase64(vaultSalt),
    pinSalt: record.pinSalt,
    credentialId: record.credentialId,
    encKey: blobToStored(encKey),
    encMeta: blobToStored(encMeta),
    createdAt: Date.now(),
  }
  await (await db()).put(STORE, full, RECORD_KEY)

  return toUnlocked(parsed.privateKeyPkcs8, metadata)
}

/** Desbloquea el certificado con biometría o PIN y devuelve la clave de firma en memoria. */
export async function unlockVault(pin?: string): Promise<UnlockedVault> {
  const record = (await (await db()).get(STORE, RECORD_KEY)) as VaultRecord | undefined
  if (!record) throw new Error('No hay ningún certificado guardado.')

  const vaultSalt = base64ToBytes(record.vaultSalt)
  let protectionKey: CryptoKey
  if (record.method === 'webauthn-prf') {
    if (!record.credentialId) throw new Error('Registro biométrico dañado.')
    protectionKey = await derivePrfKey(base64ToBytes(record.credentialId), vaultSalt)
  } else {
    if (!pin) throw new Error('Ingresa tu PIN.')
    if (!record.pinSalt) throw new Error('Registro de PIN dañado.')
    protectionKey = await derivePinKey(pin, base64ToBytes(record.pinSalt))
  }

  let pkcs8: Uint8Array
  let metadata: CertMetadata
  try {
    pkcs8 = await aesDecrypt(protectionKey, storedToBlob(record.encKey))
    const metaBytes = await aesDecrypt(protectionKey, storedToBlob(record.encMeta))
    metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as CertMetadata
  } catch {
    throw new Error(record.method === 'pin' ? 'PIN incorrecto.' : 'No se pudo descifrar el certificado.')
  }

  return toUnlocked(pkcs8, metadata)
}

/** Borra de forma irreversible el certificado y sus datos (derecho de supresión, LOPDA). */
export async function wipeVault(): Promise<void> {
  await (await db()).delete(STORE, RECORD_KEY)
}

async function toUnlocked(pkcs8: Uint8Array, metadata: CertMetadata): Promise<UnlockedVault> {
  // Importamos la clave como NO extraíble: a partir de aquí ni un XSS puede leer su material.
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // Limpiamos la copia en claro de la clave en memoria lo antes posible.
  pkcs8.fill(0)

  return {
    signingKey,
    leafCertDer: base64ToBytes(metadata.leafCertDer),
    chainDer: metadata.chainDer.map(base64ToBytes),
    subject: metadata.subject,
    validFrom: new Date(metadata.validFrom),
    validTo: new Date(metadata.validTo),
  }
}
