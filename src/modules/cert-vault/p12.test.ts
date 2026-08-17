// @vitest-environment node
import { describe, it, expect } from 'vitest'
import forge from 'node-forge'
import { binaryStringToBytes, toArrayBuffer } from '../../lib/bytes'
import { parseP12, P12ParseError } from './p12'

/** Genera un .p12 de prueba (clave + certificado autofirmado) en memoria. */
function makeTestP12(password: string, commonName = 'JUAN PEREZ', id = '0102030405') {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'PRUEBA SA' },
    { type: '2.5.4.5', value: id }, // serialNumber (OID)
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
  return binaryStringToBytes(forge.asn1.toDer(asn1).getBytes())
}

/** Extensión del esquema EC: el valor es el DER de una cadena, como en un cert real. */
function ecExt(oid: string, text: string) {
  const str = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.PRINTABLESTRING,
    false,
    text,
  )
  return { id: oid, value: forge.asn1.toDer(str).getBytes() }
}

/** .p12 con extensiones del esquema ecuatoriano, como los emite una AC acreditada. */
function makeEcP12(
  exts: Array<{ id: string; value: string }>,
  subjectAttrs: Array<Record<string, unknown>> = [],
) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '03'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  cert.setSubject([{ name: 'commonName', value: 'MARIA LOPEZ' }, ...subjectAttrs] as never)
  cert.setIssuer([{ name: 'commonName', value: 'AC PRUEBA' }])
  if (exts.length) cert.setExtensions(exts as never)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'x', { algorithm: '3des' })
  return binaryStringToBytes(forge.asn1.toDer(asn1).getBytes())
}

describe('parseP12', () => {
  it('extrae sujeto, vigencia y clave de un .p12 con contraseña', () => {
    const p12 = makeTestP12('secreto123')
    const parsed = parseP12(p12, 'secreto123')

    expect(parsed.subject.commonName).toBe('JUAN PEREZ')
    expect(parsed.subject.organization).toBe('PRUEBA SA')
    expect(parsed.subject.identification).toBe('0102030405')
    expect(parsed.keyAlgorithm).toBe('RSA')
    expect(parsed.leafCertDer.length).toBeGreaterThan(0)
    expect(parsed.chainDer.length).toBeGreaterThanOrEqual(1)
    expect(parsed.validTo.getFullYear()).toBe(2030)
  })

  it('soporta contraseña vacía (opcional)', () => {
    const p12 = makeTestP12('')
    const parsed = parseP12(p12, '')
    expect(parsed.subject.commonName).toBe('JUAN PEREZ')
  })

  it('lanza error claro con contraseña incorrecta', () => {
    const p12 = makeTestP12('correcta')
    expect(() => parseP12(p12, 'incorrecta')).toThrow(P12ParseError)
  })

  it('la clave PKCS#8 se importa a WebCrypto como clave de firma NO extraíble', async () => {
    const p12 = makeTestP12('x')
    const parsed = parseP12(p12, 'x')
    const key = await crypto.subtle.importKey(
      'pkcs8',
      toArrayBuffer(parsed.privateKeyPkcs8),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    expect(key.extractable).toBe(false)
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      toArrayBuffer(new TextEncoder().encode('hola')),
    )
    expect(sig.byteLength).toBeGreaterThan(0)
  })

  it('decodifica nombres UTF-8 (tildes y Ñ) sin mojibake', () => {
    const cn = 'JEFFERSON ROBERTO MOSQUERA VIÑAN'
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '02'
    cert.validity.notBefore = new Date('2024-01-01')
    cert.validity.notAfter = new Date('2030-06-15')
    // CN como UTF8String: forge codifica el string a UTF-8 en el DER (Ñ -> 0xC3 0x91),
    // igual que un certificado real ecuatoriano.
    const attrs = [
      { name: 'commonName', value: cn, valueTagClass: forge.asn1.Type.UTF8 as never },
      { type: '2.5.4.5', value: '0950194407' },
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'x', { algorithm: '3des' })
    const bytes = binaryStringToBytes(forge.asn1.toDer(asn1).getBytes())

    const parsed = parseP12(bytes, 'x')
    expect(parsed.subject.commonName).toBe(cn)
    expect(parsed.subject.commonName).not.toContain('Ã')
  })

  // Casos que ya funcionaban antes de soportar todas las AC: se comprueban de punta a
  // punta (no solo el extractor) para que un cambio en la resolución no los rompa.
  it('sigue leyendo el esquema EC clásico: jurídica con razón social, RUC y cargo', () => {
    const p12 = makeEcP12([
      ecExt('1.3.6.1.4.1.37746.3.1', '0912345678'),
      ecExt('1.3.6.1.4.1.37746.3.5', 'GERENTE GENERAL'),
      ecExt('1.3.6.1.4.1.37746.3.10', 'AZIRGO SA'),
      ecExt('1.3.6.1.4.1.37746.3.11', '0993372015001'),
    ])
    const { subject } = parseP12(p12, 'x')
    expect(subject).toMatchObject({
      commonName: 'MARIA LOPEZ',
      identification: '0912345678',
      position: 'GERENTE GENERAL',
      companyName: 'AZIRGO SA',
      companyRuc: '0993372015001',
      personType: 'juridica',
      personTypeLabel: 'Persona Jurídica',
    })
    expect(subject.companyRucDerived).toBeUndefined()
  })

  it('sigue leyendo persona natural con RUC propio en el certificado', () => {
    const p12 = makeEcP12([
      ecExt('1.3.6.1.4.1.37746.3.1', '0912345678'),
      ecExt('1.3.6.1.4.1.37746.3.11', '0912345678001'),
    ])
    const { subject } = parseP12(p12, 'x')
    expect(subject).toMatchObject({
      identification: '0912345678',
      companyRuc: '0912345678001',
      personType: 'natural_ruc',
    })
    expect(subject.companyName).toBeUndefined()
  })

  it('un certificado sin extensiones EC sigue cayendo al serialNumber del DN', () => {
    const p12 = makeEcP12([], [{ type: '2.5.4.5', value: '0950194407-040425153037' }])
    const { subject } = parseP12(p12, 'x')
    expect(subject.identification).toBe('0950194407-040425153037')
    expect(subject.commonName).toBe('MARIA LOPEZ')
    expect(subject.personType).toBe('natural')
  })

  it('no confunde surname con serialNumber al leer el Subject DN', () => {
    const p12 = makeEcP12(
      [],
      [
        { type: '2.5.4.4', value: 'LOPEZ' },
        { type: '2.5.4.42', value: 'MARIA' },
        { type: '2.5.4.5', value: '0912345678' },
      ],
    )
    const { subject } = parseP12(p12, 'x')
    expect(subject.identification).toBe('0912345678')
    expect(subject.commonName).toBe('MARIA LOPEZ')
  })
})
