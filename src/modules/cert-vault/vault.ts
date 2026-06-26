import { openDB, type IDBPDatabase } from 'idb'
import { base64ToBytes, bytesToBase64, bytesToHex, toArrayBuffer } from '../../lib/bytes'
import { parseP12, readSubjectFromDer, type CertSubject } from './p12'
import {
  aesDecrypt,
  aesEncrypt,
  createPrfCredential,
  derivePinKey,
  derivePinKeyPbkdf2,
  derivePrfKey,
  isWebAuthnPrfSupported,
  DEFAULT_ARGON_PARAMS,
  type ArgonParams,
  type EncryptedBlob,
  type Kdf,
  type ProtectionMethod,
} from './key-protection'

const DB_NAME = 'firmaok-vault'
const STORE = 'vault' // certificados, keyed por id (huella)
const META_STORE = 'meta' // datos a nivel de app (passkey PRF compartida)
const LEGACY_KEY = 'default'
const SHARED_PRF_KEY = 'shared-prf'

interface StoredEncryptedBlob {
  iv: string
  ct: string
}

interface VaultRecord {
  id: string // huella SHA-256 del cert hoja
  label: string // nombre del firmante (en claro, para la lista)
  validTo: string // ISO (en claro, para la lista)
  method: ProtectionMethod
  kdf?: Kdf // 'argon2id' | 'pbkdf2' (ausente = legacy pbkdf2)
  vaultSalt: string
  pinSalt?: string
  argonParams?: ArgonParams
  credentialId?: string
  encKey: StoredEncryptedBlob // PKCS#8 cifrado
  encMeta: StoredEncryptedBlob // metadatos completos cifrados (datos personales)
  createdAt: number
}

interface CertMetadata {
  leafCertDer: string
  chainDer: string[]
  subject: CertSubject
  validFrom: string
  validTo: string
}

/** Resumen visible sin desbloquear (solo el nombre + vigencia + método). */
export interface CertSummary {
  id: string
  label: string
  validTo?: Date
  method: ProtectionMethod
  expired: boolean
}

/** Certificado descifrado y listo para firmar en la sesión actual (solo en memoria). */
export interface UnlockedVault {
  id: string
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
  /** Contraseña maestra requerida cuando method === 'pin'. */
  pin?: string
  /** Parámetros de Argon2id (opcional; por defecto los seguros). Útil para tuning/tests. */
  argonParams?: ArgonParams
}

export class DuplicateCertError extends Error {}

function blobToStored(b: EncryptedBlob): StoredEncryptedBlob {
  return { iv: bytesToBase64(b.iv), ct: bytesToBase64(b.ciphertext) }
}
function storedToBlob(s: StoredEncryptedBlob): EncryptedBlob {
  return { iv: base64ToBytes(s.iv), ciphertext: base64ToBytes(s.ct) }
}

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE)
    },
  })
}

async function fingerprint(leafCertDer: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(leafCertDer)))
  return bytesToHex(h)
}

// ---------- Listado ----------

export async function listCertificates(): Promise<CertSummary[]> {
  const dbi = await db()
  const [keys, values] = await Promise.all([dbi.getAllKeys(STORE), dbi.getAll(STORE)])
  const now = Date.now()
  const out: CertSummary[] = []
  for (let i = 0; i < values.length; i++) {
    const rec = values[i] as VaultRecord
    const key = String(keys[i])
    if (rec.id && rec.label) {
      const validTo = rec.validTo ? new Date(rec.validTo) : undefined
      out.push({
        id: rec.id,
        label: rec.label,
        validTo,
        method: rec.method,
        expired: validTo ? validTo.getTime() < now : false,
      })
    } else {
      // Registro legacy (formato antiguo): sin nombre en claro hasta desbloquear.
      out.push({
        id: LEGACY_KEY,
        label: 'Certificado guardado',
        method: (rec.method as ProtectionMethod) ?? 'pin',
        expired: false,
      })
      void key
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

// ---------- Importar ----------

export interface ImportResult {
  id: string
  unlocked: UnlockedVault
}

export async function importP12(p12Bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const parsed = parseP12(p12Bytes, opts.password ?? '')
  const id = await fingerprint(parsed.leafCertDer)

  const dbi = await db()
  if (await dbi.get(STORE, id)) {
    throw new DuplicateCertError('Este certificado ya está importado.')
  }

  const vaultSalt = crypto.getRandomValues(new Uint8Array(16))
  let protectionKey: CryptoKey
  let pinSalt: string | undefined
  let credentialId: string | undefined
  let argonParams: ArgonParams | undefined
  let kdf: Kdf

  if (opts.method === 'webauthn-prf') {
    if (!isWebAuthnPrfSupported()) {
      throw new Error('Este navegador no soporta biometría (WebAuthn). Usa una contraseña maestra.')
    }
    // Reutiliza una passkey PRF compartida; la guarda SOLO tras un derive exitoso
    // (si PRF falla por un gestor externo, no deja un registro inservible).
    const existing = (await dbi.get(META_STORE, SHARED_PRF_KEY)) as
      | { credentialId: string }
      | undefined
    let credBytes: Uint8Array
    let isNew = false
    if (existing?.credentialId) {
      credBytes = base64ToBytes(existing.credentialId)
    } else {
      const created = await createPrfCredential()
      credBytes = created.credentialId
      isNew = true
    }
    protectionKey = await derivePrfKey(credBytes, vaultSalt) // valida PRF con un get real
    credentialId = bytesToBase64(credBytes)
    if (isNew) await dbi.put(META_STORE, { credentialId }, SHARED_PRF_KEY)
    kdf = 'argon2id' // no aplica al PRF; marcamos formato nuevo
  } else {
    if (!opts.pin || opts.pin.length < 10) {
      throw new Error('La contraseña maestra debe tener al menos 10 caracteres.')
    }
    const salt = crypto.getRandomValues(new Uint8Array(16))
    pinSalt = bytesToBase64(salt)
    argonParams = opts.argonParams ?? DEFAULT_ARGON_PARAMS
    kdf = 'argon2id'
    protectionKey = await derivePinKey(opts.pin, salt, argonParams)
  }

  const metadata: CertMetadata = {
    leafCertDer: bytesToBase64(parsed.leafCertDer),
    chainDer: parsed.chainDer.map(bytesToBase64),
    subject: parsed.subject,
    validFrom: parsed.validFrom.toISOString(),
    validTo: parsed.validTo.toISOString(),
  }

  const encKey = await aesEncrypt(protectionKey, parsed.privateKeyPkcs8)
  const encMeta = await aesEncrypt(protectionKey, new TextEncoder().encode(JSON.stringify(metadata)))

  const record: VaultRecord = {
    id,
    label: parsed.subject.commonName,
    validTo: parsed.validTo.toISOString(),
    method: opts.method,
    kdf,
    vaultSalt: bytesToBase64(vaultSalt),
    pinSalt,
    argonParams,
    credentialId,
    encKey: blobToStored(encKey),
    encMeta: blobToStored(encMeta),
    createdAt: Date.now(),
  }
  await dbi.put(STORE, record, id)

  const unlocked = await toUnlocked(id, parsed.privateKeyPkcs8, metadata)
  return { id, unlocked }
}

// ---------- Desbloquear ----------

export async function unlockVault(id: string, pin?: string): Promise<ImportResult> {
  const dbi = await db()
  const record = (await dbi.get(STORE, id)) as VaultRecord | undefined
  if (!record) throw new Error('No se encontró el certificado.')

  const protectionKey = await deriveProtectionKey(record, pin)

  let pkcs8: Uint8Array
  let metadata: CertMetadata
  try {
    pkcs8 = await aesDecrypt(protectionKey, storedToBlob(record.encKey))
    const metaBytes = await aesDecrypt(protectionKey, storedToBlob(record.encMeta))
    metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as CertMetadata
  } catch {
    throw new Error(
      record.method === 'pin' ? 'Contraseña incorrecta.' : 'No se pudo descifrar el certificado.',
    )
  }

  // Migración de registro legacy al formato nuevo (con nombre/vigencia en claro).
  let finalId = id
  if (id === LEGACY_KEY || !record.id || !record.label) {
    finalId = await migrateLegacy(record, metadata)
  }

  const unlocked = await toUnlocked(finalId, pkcs8, metadata)
  return { id: finalId, unlocked }
}

async function deriveProtectionKey(record: VaultRecord, pin?: string): Promise<CryptoKey> {
  const vaultSalt = base64ToBytes(record.vaultSalt)
  if (record.method === 'webauthn-prf') {
    if (!record.credentialId) throw new Error('Registro biométrico dañado.')
    return derivePrfKey(base64ToBytes(record.credentialId), vaultSalt)
  }
  if (!pin) throw new Error('Ingresa tu contraseña maestra.')
  if (!record.pinSalt) throw new Error('Registro de contraseña dañado.')
  const salt = base64ToBytes(record.pinSalt)
  // Argon2id para registros nuevos; PBKDF2 para los legacy (sin kdf).
  if (record.kdf === 'argon2id') {
    return derivePinKey(pin, salt, record.argonParams ?? DEFAULT_ARGON_PARAMS)
  }
  return derivePinKeyPbkdf2(pin, salt)
}

/** Re-escribe un registro legacy con el formato nuevo (id por huella, nombre en claro). */
async function migrateLegacy(record: VaultRecord, metadata: CertMetadata): Promise<string> {
  try {
    const leafCertDer = base64ToBytes(metadata.leafCertDer)
    const id = await fingerprint(leafCertDer)
    const subject = readSubjectFromDer(leafCertDer)
    const dbi = await db()
    const migrated: VaultRecord = {
      ...record,
      id,
      label: subject.commonName,
      validTo: metadata.validTo,
    }
    await dbi.put(STORE, migrated, id)
    await dbi.delete(STORE, LEGACY_KEY)
    return id
  } catch {
    return LEGACY_KEY
  }
}

// ---------- Borrar ----------

export async function deleteCertificate(id: string): Promise<void> {
  await (await db()).delete(STORE, id)
}

export async function wipeAll(): Promise<void> {
  const dbi = await db()
  await dbi.clear(STORE)
  await dbi.clear(META_STORE)
}

// ---------- Helpers ----------

async function toUnlocked(
  id: string,
  pkcs8: Uint8Array,
  metadata: CertMetadata,
): Promise<UnlockedVault> {
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

  const leafCertDer = base64ToBytes(metadata.leafCertDer)
  let subject = metadata.subject
  try {
    subject = readSubjectFromDer(leafCertDer)
  } catch {
    // Si falla, conservamos el subject guardado.
  }

  return {
    id,
    signingKey,
    leafCertDer,
    chainDer: metadata.chainDer.map(base64ToBytes),
    subject,
    validFrom: new Date(metadata.validFrom),
    validTo: new Date(metadata.validTo),
  }
}
