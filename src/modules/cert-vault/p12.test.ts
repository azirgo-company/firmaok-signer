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
})
