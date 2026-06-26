// @vitest-environment node
import { describe, it, expect } from 'vitest'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { binaryStringToBytes, toArrayBuffer } from '../../lib/bytes'
import type { UnlockedVault } from '../cert-vault/vault'
import { signPdf } from './index'
import { validatePdf } from '../pdf-validator'

async function makeVault(name = 'CARLOS RUIZ', id = '0912345678'): Promise<UnlockedVault> {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '7F'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  const attrs = [
    { name: 'commonName', value: name },
    { name: 'organizationName', value: 'BANCO CENTRAL DEL ECUADOR' },
    { type: '2.5.4.5', value: id },
  ]
  cert.setSubject(attrs)
  cert.setIssuer([{ name: 'commonName', value: 'AC BCE' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const certDer = binaryStringToBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
  const pkcs8 = binaryStringToBytes(
    forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey))).getBytes(),
  )
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return {
    signingKey,
    leafCertDer: certDer,
    chainDer: [certDer],
    subject: { commonName: name, identification: id, serialNumber: id },
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
}

async function makeSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842]) // A4
  page.drawText('Documento de prueba FirmaOK', { x: 50, y: 800, size: 14 })
  return doc.save()
}

describe('signPdf + validatePdf (end-to-end)', () => {
  it('firma un PDF con firma visible y la validación la reconoce íntegra', async () => {
    const vault = await makeVault()
    const pdf = await makeSamplePdf()

    const signed = await signPdf({
      pdfBytes: pdf,
      vault,
      appearance: { name: vault.subject.commonName, identification: vault.subject.identification, reason: 'Aprobación' },
      position: { pageIndex: 0, x: 50, y: 50, width: 220, height: 70 },
      signingTime: new Date('2026-06-26T15:00:00Z'),
    })

    expect(signed.length).toBeGreaterThan(pdf.length)

    const reports = await validatePdf(signed)
    expect(reports.length).toBe(1)
    const r = reports[0]
    expect(r.signerName).toBe('CARLOS RUIZ')
    expect(r.identification).toBe('0912345678')
    expect(r.issuer).toBe('AC BCE')
    expect(r.organization).toBe('BANCO CENTRAL DEL ECUADOR')
    expect(r.integrityValid).toBe(true)
    expect(r.signingTime?.toISOString()).toBe('2026-06-26T15:00:00.000Z')
    // Reporte enriquecido
    expect(r.padesProfile).toBe('B-B (básica)')
    expect(r.hashAlgorithm).toBe('SHA-256')
    expect(r.signatureAlgorithm).toBe('SHA256withRSA')
    expect(r.reason).toBe('Aprobación')
    expect(r.certFingerprintSha256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2})+$/)
    expect(r.appendedBytesAfter).toBe(0)
    expect(r.coveredBytes).toBeGreaterThan(0)
  })

  it('separa la cédula del nombre cuando el CN la incluye (certificados de Ecuador)', async () => {
    const vault = await makeVault('0950194407 JEFFERSON ROBERTO MOSQUERA', '0950194407-040425153037')
    const pdf = await makeSamplePdf()
    const signed = await signPdf({
      pdfBytes: pdf,
      vault,
      appearance: { name: vault.subject.commonName },
      position: { pageIndex: 0, x: 50, y: 50, width: 220, height: 70 },
    })
    const reports = await validatePdf(signed)
    expect(reports[0].signerName).toBe('JEFFERSON ROBERTO MOSQUERA')
    expect(reports[0].identification).toBe('0950194407-040425153037')
  })

  it('descarta coincidencias de /ByteRange que no son un CMS válido (falsos positivos)', async () => {
    const fake = new TextEncoder().encode(
      '%PDF-1.7\n/ByteRange [0 10 30 10]\n/Contents <deadbeef00>\nbasura no-cms\n%%EOF',
    )
    const reports = await validatePdf(fake)
    expect(reports.length).toBe(0)
  })

  it('detecta integridad rota si el PDF firmado se altera', async () => {
    const vault = await makeVault('LUCIA MORA', '1100110011')
    const pdf = await makeSamplePdf()
    const signed = await signPdf({
      pdfBytes: pdf,
      vault,
      appearance: { name: 'LUCIA MORA' },
      position: { pageIndex: 0, x: 50, y: 50, width: 220, height: 70 },
    })

    // Alteramos un byte dentro del rango firmado (cerca del inicio del contenido).
    const tampered = signed.slice()
    tampered[100] = tampered[100] ^ 0xff

    const reports = await validatePdf(tampered)
    expect(reports.length).toBeGreaterThanOrEqual(1)
    expect(reports[0].integrityValid).toBe(false)
  })
})
