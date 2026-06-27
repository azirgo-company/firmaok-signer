import { openDB, type IDBPDatabase } from 'idb'
import { base64ToBytes, bytesToBase64, bytesToHex, toArrayBuffer } from '../../lib/bytes'
import { parseP12, readSubjectFromDer, type CertSubject } from './p12'
import {
  aesDecrypt,
  aesEncrypt,
  deriveMasterKey,
  DEFAULT_ARGON_PARAMS,
  type ArgonParams,
  type EncryptedBlob,
} from './key-protection'

const DB_NAME = 'firmaok-vault'
const STORE = 'vault' // certificados, keyed por id (huella)
const META_STORE = 'meta' // contraseña maestra (verificador)
const MASTER_KEY = 'master'
const MASTER_TOKEN = 'firmaok-master-v1'

interface StoredEncryptedBlob {
  iv: string
  ct: string
}

interface VaultRecord {
  id: string // huella SHA-256 del cert hoja
  label: string // nombre del firmante (en claro, para la lista)
  validTo: string // ISO (en claro, para la lista)
  encKey: StoredEncryptedBlob // PKCS#8 cifrado con la clave maestra
  encMeta: StoredEncryptedBlob // metadatos completos cifrados
  createdAt: number
}

interface MasterRecord {
  salt: string
  argonParams: ArgonParams
  verifier: StoredEncryptedBlob // token cifrado, para validar la contraseña
}

interface CertMetadata {
  leafCertDer: string
  chainDer: string[]
  subject: CertSubject
  validFrom: string
  validTo: string
}

/** Resumen visible sin desbloquear (solo el nombre + vigencia). */
export interface CertSummary {
  id: string
  label: string
  validTo?: Date
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
  /** Contraseña del propio .p12 (opcional). */
  certPassword?: string
  /** Contraseña maestra de la app (única para todos los certificados). */
  masterPassword: string
  /** Argon2id params (opcional; por defecto los seguros). Útil para tests. */
  argonParams?: ArgonParams
}

export interface ImportResult {
  id: string
  unlocked: UnlockedVault
}

export class DuplicateCertError extends Error {}
export const MASTER_MIN_LENGTH = 12

function blobToStored(b: EncryptedBlob): StoredEncryptedBlob {
  return { iv: bytesToBase64(b.iv), ct: bytesToBase64(b.ciphertext) }
}
function storedToBlob(s: StoredEncryptedBlob): EncryptedBlob {
  return { iv: base64ToBytes(s.iv), ciphertext: base64ToBytes(s.ct) }
}

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 3, {
    upgrade(database) {
      // El modelo de cifrado cambió (una sola contraseña maestra): empezamos limpio.
      if (database.objectStoreNames.contains(STORE)) database.deleteObjectStore(STORE)
      if (database.objectStoreNames.contains(META_STORE)) database.deleteObjectStore(META_STORE)
      database.createObjectStore(STORE)
      database.createObjectStore(META_STORE)
    },
  })
}

async function fingerprint(leafCertDer: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(leafCertDer)))
  return bytesToHex(h)
}

// ---------- Contraseña maestra ----------

export async function hasMasterPassword(): Promise<boolean> {
  return Boolean(await (await db()).get(META_STORE, MASTER_KEY))
}

/**
 * Deriva (y valida) la clave maestra. Si no existe, la crea (la contraseña debe
 * tener al menos MASTER_MIN_LENGTH). Si existe, verifica la contraseña.
 */
async function getMasterKey(
  password: string,
  argonParams: ArgonParams = DEFAULT_ARGON_PARAMS,
): Promise<CryptoKey> {
  const dbi = await db()
  const meta = (await dbi.get(META_STORE, MASTER_KEY)) as MasterRecord | undefined

  if (meta) {
    const key = await deriveMasterKey(password, base64ToBytes(meta.salt), meta.argonParams)
    try {
      const tok = await aesDecrypt(key, storedToBlob(meta.verifier))
      if (new TextDecoder().decode(tok) !== MASTER_TOKEN) throw new Error()
    } catch {
      throw new Error('Contraseña maestra incorrecta.')
    }
    return key
  }

  // Primera vez: crear la contraseña maestra.
  if (password.length < MASTER_MIN_LENGTH) {
    throw new Error(`La contraseña maestra debe tener al menos ${MASTER_MIN_LENGTH} caracteres.`)
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveMasterKey(password, salt, argonParams)
  const verifier = await aesEncrypt(key, new TextEncoder().encode(MASTER_TOKEN))
  await dbi.put(
    META_STORE,
    { salt: bytesToBase64(salt), argonParams, verifier: blobToStored(verifier) },
    MASTER_KEY,
  )
  return key
}

// ---------- Listado ----------

export async function listCertificates(): Promise<CertSummary[]> {
  const all = (await (await db()).getAll(STORE)) as VaultRecord[]
  const now = Date.now()
  return all
    .filter((r) => r.id && r.label)
    .map((r) => {
      const validTo = r.validTo ? new Date(r.validTo) : undefined
      return {
        id: r.id,
        label: r.label,
        validTo,
        expired: validTo ? validTo.getTime() < now : false,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

// ---------- Importar ----------

export async function importP12(p12Bytes: Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  const parsed = parseP12(p12Bytes, opts.certPassword ?? '')
  const id = await fingerprint(parsed.leafCertDer)

  const dbi = await db()
  if (await dbi.get(STORE, id)) {
    throw new DuplicateCertError('Este certificado ya está importado.')
  }

  const masterKey = await getMasterKey(opts.masterPassword, opts.argonParams)

  const metadata: CertMetadata = {
    leafCertDer: bytesToBase64(parsed.leafCertDer),
    chainDer: parsed.chainDer.map(bytesToBase64),
    subject: parsed.subject,
    validFrom: parsed.validFrom.toISOString(),
    validTo: parsed.validTo.toISOString(),
  }

  const encKey = await aesEncrypt(masterKey, parsed.privateKeyPkcs8)
  const encMeta = await aesEncrypt(masterKey, new TextEncoder().encode(JSON.stringify(metadata)))

  const record: VaultRecord = {
    id,
    label: parsed.subject.commonName,
    validTo: parsed.validTo.toISOString(),
    encKey: blobToStored(encKey),
    encMeta: blobToStored(encMeta),
    createdAt: Date.now(),
  }
  await dbi.put(STORE, record, id)

  const unlocked = await toUnlocked(id, parsed.privateKeyPkcs8, metadata)
  return { id, unlocked }
}

// ---------- Desbloquear ----------

export async function unlockVault(id: string, masterPassword: string): Promise<ImportResult> {
  const dbi = await db()
  const record = (await dbi.get(STORE, id)) as VaultRecord | undefined
  if (!record) throw new Error('No se encontró el certificado.')

  const masterKey = await getMasterKey(masterPassword) // valida la contraseña

  const pkcs8 = await aesDecrypt(masterKey, storedToBlob(record.encKey))
  const metaBytes = await aesDecrypt(masterKey, storedToBlob(record.encMeta))
  const metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as CertMetadata

  const unlocked = await toUnlocked(id, pkcs8, metadata)
  return { id, unlocked }
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
