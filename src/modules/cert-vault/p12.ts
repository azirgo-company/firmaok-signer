import forge from 'node-forge'
import { binaryStringToBytes } from '../../lib/bytes'

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
  /** Identificación (cédula/RUC) si viene en el campo serialNumber del subject. */
  identification?: string
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

function readSubject(cert: forge.pki.Certificate): CertSubject {
  // Buscamos por shortName, name u OID para máxima compatibilidad entre certificados.
  const attrs = cert.subject.attributes as Array<{
    shortName?: string
    name?: string
    type?: string
    value?: unknown
  }>
  const get = (...keys: string[]) => {
    const a = attrs.find((x) => keys.includes(x.shortName ?? '') || keys.includes(x.name ?? '') || keys.includes(x.type ?? ''))
    return typeof a?.value === 'string' ? a.value : undefined
  }
  const serialNumber = get('serialNumber', '2.5.4.5')
  return {
    commonName: get('CN', 'commonName', '2.5.4.3') ?? 'Desconocido',
    organization: get('O', 'organizationName', '2.5.4.10'),
    serialNumber,
    // En certificados ecuatorianos la cédula/RUC suele ir en serialNumber del subject.
    identification: serialNumber,
  }
}
