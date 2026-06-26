import forge from 'node-forge'
import { binaryStringToBytes, bytesToBinaryString } from '../../lib/bytes'
import {
  classifyPerson,
  EC_FIELD,
  ecFieldNumber,
  type EcFields,
  type PersonType,
} from '../../lib/ecuador-cert'

export interface ParsedP12 {
  /** Clave privada en DER PKCS#8, lista para importar a WebCrypto. */
  privateKeyPkcs8: Uint8Array
  /** Certificado del firmante (hoja) en DER. */
  leafCertDer: Uint8Array
  /** Cadena completa de certificados (hoja + intermedias) en DER. */
  chainDer: Uint8Array[]
  /** Datos legibles del firmante para la UI. */
  subject: CertSubject
  /** Vigencia del certificado. */
  validFrom: Date
  validTo: Date
  keyAlgorithm: 'RSA'
}

export interface CertSubject {
  commonName: string
  organization?: string
  serialNumber?: string
  /** Cédula del firmante (preferida desde la extensión ecuatoriana). */
  identification?: string
  /** Cargo del firmante (esquema ecuatoriano). */
  position?: string
  /** Razón social de la empresa representada. */
  companyName?: string
  /** RUC de la empresa (jurídica) o personal (natural con RUC). */
  companyRuc?: string
  /** Tipo de firmante: persona natural / natural con RUC / jurídica. */
  personType?: PersonType
  personTypeLabel?: string
}

export class P12ParseError extends Error {}

/**
 * Parsea un archivo PKCS#12 (.p12/.pfx). La contraseña es opcional: muchos certificados
 * de prueba o algunos flujos usan contraseña vacía. Si la contraseña es incorrecta,
 * node-forge lanza un error de MAC que traducimos a un mensaje claro.
 */
export function parseP12(p12Bytes: Uint8Array, password = ''): ParsedP12 {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const buffer = forge.util.createBuffer()
    // Cargamos byte a byte por bloques para evitar problemas de codificación.
    const chunk = 0x8000
    for (let i = 0; i < p12Bytes.length; i += chunk) {
      buffer.putBytes(String.fromCharCode(...p12Bytes.subarray(i, i + chunk)))
    }
    const asn1 = forge.asn1.fromDer(buffer)
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    if (/PKCS#12 MAC|Invalid password|integrity/i.test(msg)) {
      throw new P12ParseError('Contraseña del certificado incorrecta.')
    }
    throw new P12ParseError('No se pudo leer el archivo .p12 (formato inválido o dañado).')
  }

  const privateKey = extractPrivateKey(p12)
  if (!isRsaPrivateKey(privateKey)) {
    throw new P12ParseError('Por ahora solo se soportan certificados con clave RSA.')
  }

  const certs = extractCertificates(p12)
  if (certs.length === 0) {
    throw new P12ParseError('El .p12 no contiene certificados.')
  }

  const leaf = findLeafCertificate(certs, privateKey)
  const chain = orderChain(leaf, certs)

  return {
    privateKeyPkcs8: privateKeyToPkcs8Der(privateKey),
    leafCertDer: certToDer(leaf),
    chainDer: chain.map(certToDer),
    subject: readSubject(leaf),
    validFrom: leaf.validity.notBefore,
    validTo: leaf.validity.notAfter,
    keyAlgorithm: 'RSA',
  }
}

function extractPrivateKey(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.PrivateKey {
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const shroudedBags = shrouded[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
  if (shroudedBags[0]?.key) return shroudedBags[0].key
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })
  const plainBags = plain[forge.pki.oids.keyBag] ?? []
  if (plainBags[0]?.key) return plainBags[0].key
  throw new P12ParseError('El .p12 no contiene una clave privada.')
}

function extractCertificates(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate[] {
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBags = bags[forge.pki.oids.certBag] ?? []
  return certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c))
}

function isRsaPrivateKey(key: forge.pki.PrivateKey): key is forge.pki.rsa.PrivateKey {
  return typeof (key as forge.pki.rsa.PrivateKey).n !== 'undefined'
}

/** La hoja es el certificado cuya clave pública corresponde a la clave privada. */
function findLeafCertificate(
  certs: forge.pki.Certificate[],
  privateKey: forge.pki.rsa.PrivateKey,
): forge.pki.Certificate {
  const match = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey
    return pub?.n && pub.n.equals(privateKey.n)
  })
  return match ?? certs[0]
}

/** Ordena la cadena hoja -> intermedias siguiendo issuer/subject. */
function orderChain(
  leaf: forge.pki.Certificate,
  all: forge.pki.Certificate[],
): forge.pki.Certificate[] {
  const chain: forge.pki.Certificate[] = [leaf]
  let current = leaf
  const remaining = all.filter((c) => c !== leaf)
  // Encadenamos por issuer hasta no encontrar el emisor (raíz puede no estar incluida).
  for (let i = 0; i < remaining.length; i++) {
    const issuer = remaining.find((c) => c.subject.hash === current.issuer.hash)
    if (!issuer || issuer === current) break
    chain.push(issuer)
    current = issuer
  }
  return chain
}

function privateKeyToPkcs8Der(key: forge.pki.rsa.PrivateKey): Uint8Array {
  const rsaAsn1 = forge.pki.privateKeyToAsn1(key)
  const pkcs8Asn1 = forge.pki.wrapRsaPrivateKey(rsaAsn1)
  return binaryStringToBytes(forge.asn1.toDer(pkcs8Asn1).getBytes())
}

function certToDer(cert: forge.pki.Certificate): Uint8Array {
  const asn1 = forge.pki.certificateToAsn1(cert)
  return binaryStringToBytes(forge.asn1.toDer(asn1).getBytes())
}

/** Re-parsea los datos del firmante desde el certificado DER (para certificados ya guardados). */
export function readSubjectFromDer(der: Uint8Array): CertSubject {
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(bytesToBinaryString(der)))
  return readSubject(cert)
}

function readSubject(cert: forge.pki.Certificate): CertSubject {
  // Buscamos por shortName, name u OID para máxima compatibilidad entre certificados.
  const attrs = cert.subject.attributes as Array<{
    shortName?: string
    name?: string
    type?: string
    value?: unknown
    valueTagClass?: number
  }>
  const get = (...keys: string[]) => {
    const a = attrs.find((x) => keys.includes(x.shortName ?? '') || keys.includes(x.name ?? '') || keys.includes(x.type ?? ''))
    return typeof a?.value === 'string' ? decodeDirectoryString(a.value, a.valueTagClass) : undefined
  }
  const serialNumber = get('serialNumber', '2.5.4.5')
  // La cédula y datos del firmante están en extensiones del esquema EC (.3.N); el
  // serialNumber del subject puede ser un UUID o traer sufijo. Preferimos la extensión.
  const ec = readEcFields(cert)
  const { type, label } = classifyPerson(ec)
  const { name } = splitLeadingId(get('CN', 'commonName', '2.5.4.3') ?? 'Desconocido')
  return {
    commonName: name,
    organization: get('O', 'organizationName', '2.5.4.10'),
    serialNumber,
    identification: ec.cedula || serialNumber,
    position: ec.cargo,
    companyName: ec.companyName,
    companyRuc: ec.ruc,
    personType: type,
    personTypeLabel: label,
  }
}

/** Quita una cédula/RUC inicial del CN: "0950194407 JUAN PEREZ" -> "JUAN PEREZ". */
function splitLeadingId(cn: string): { name: string } {
  const m = /^\d{8,13}[-\s]+(.+)$/.exec(cn.trim())
  return { name: m ? m[1].trim() : cn.trim() }
}

/**
 * Lee los campos del esquema ecuatoriano detectando el arco dinámicamente
 * (1.3.6.1.4.1.<PEN>.3.N), válido para cualquier AC acreditada.
 */
function readEcFields(cert: forge.pki.Certificate): EcFields {
  const exts = (cert.extensions ?? []) as Array<{ id?: string; value?: unknown }>
  const fields: EcFields = {}
  for (const ext of exts) {
    if (!ext.id || typeof ext.value !== 'string') continue
    const n = ecFieldNumber(ext.id)
    if (n === null) continue
    let value: string | undefined
    try {
      const asn1 = forge.asn1.fromDer(ext.value)
      const raw = typeof asn1.value === 'string' ? asn1.value : undefined
      value = raw ? decodeDirectoryString(raw, asn1.type as number).trim() || undefined : undefined
    } catch {
      value = undefined
    }
    if (!value) continue
    if (n === EC_FIELD.cedula) fields.cedula = value
    else if (n === EC_FIELD.cargo) fields.cargo = value
    else if (n === EC_FIELD.razonSocial) fields.companyName = value
    else if (n === EC_FIELD.ruc) fields.ruc = value
  }
  return fields
}

/**
 * node-forge entrega los UTF8String del subject como bytes crudos (binary string),
 * lo que produce mojibake con tildes/Ñ (p.ej. "VIÑAN" -> "VIÃAN"). Re-decodificamos
 * a UTF-8 cuando el tipo ASN.1 es UTF8String o cuando hay bytes altos (>=0x80).
 */
function decodeDirectoryString(value: string, tag?: number): string {
  const ASN1_UTF8 = 12
  const hasHighBytes = /[-ÿ]/.test(value)
  if (tag !== ASN1_UTF8 && !hasHighBytes) return value
  try {
    const bytes = Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff)
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    // Si la decodificación introdujo el carácter de reemplazo, conservamos el original.
    return decoded.includes('�') ? value : decoded
  } catch {
    return value
  }
}
