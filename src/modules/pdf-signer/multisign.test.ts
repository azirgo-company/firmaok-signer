// @vitest-environment node
// Multifirma: firmar un PDF que ya venía firmado debe AÑADIR la firma sin invalidar
// (ni borrar) las anteriores. Esto solo se cumple si el guardado es incremental.
import { describe, it, expect } from 'vitest'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { binaryStringToBytes, bytesToBinaryString, toArrayBuffer } from '../../lib/bytes'
import type { UnlockedVault } from '../cert-vault/vault'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { SignPdf } from '@signpdf/signpdf'
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils'
import { signPdf } from './index'
import { WebCryptoPadesSigner } from './signer'
import { validatePdf } from '../pdf-validator'

async function makeVault(name: string, id: string): Promise<UnlockedVault> {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '7F'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  cert.setSubject([
    { name: 'commonName', value: name },
    { type: '2.5.4.5', value: id },
  ])
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
    id: name,
    signingKey,
    leafCertDer: certDer,
    chainDer: [certDer],
    subject: { commonName: name, identification: id, serialNumber: id },
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
}

async function samplePdf(useObjectStreams = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842]).drawText('Documento de prueba FirmaOK', { x: 50, y: 800, size: 14 })
  return doc.save({ useObjectStreams })
}

function sign(pdfBytes: Uint8Array, vault: UnlockedVault, i: number) {
  return signPdf({
    pdfBytes,
    vault,
    appearance: { name: vault.subject.commonName },
    position: { pageIndex: 0, x: 40, y: 40 + i * 90, width: 220, height: 70 },
  })
}

describe('multifirma', () => {
  it('conserva íntegras las firmas previas y añade la nueva', async () => {
    const uno = await makeVault('FIRMANTE UNO', '1111111111')
    const dos = await makeVault('FIRMANTE DOS', '2222222222')
    const tres = await makeVault('FIRMANTE TRES', '3333333333')

    const original = await samplePdf()
    const firma1 = await sign(original, uno, 0)
    const firma2 = await sign(firma1, dos, 1)
    const firma3 = await sign(firma2, tres, 2)

    const reports = await validatePdf(firma3)
    expect(reports.map((r) => r.signerName)).toEqual([
      'FIRMANTE UNO',
      'FIRMANTE DOS',
      'FIRMANTE TRES',
    ])
    expect(reports.every((r) => r.integrityValid)).toBe(true)

    // Cada firma cubre menos bytes que la siguiente: son revisiones encadenadas.
    expect(reports[0].appendedBytesAfter).toBeGreaterThan(reports[1].appendedBytesAfter)
    expect(reports[2].appendedBytesAfter).toBe(0)

    // Los bytes del documento firmado por el primero se conservan tal cual.
    expect(firma3.subarray(0, firma1.length)).toEqual(firma1)

    // El documento sigue siendo legible y las tres firmas son campos distintos: con el
    // nombre "Signature1" repetido serían el mismo campo y el visor mostraría una sola.
    expect((await PDFDocument.load(toArrayBuffer(firma3))).getPageCount()).toBe(1)
    expect(await pdfjsFields(firma3)).toEqual(['Signature1', 'Signature2', 'Signature3'])
  }, 60000)

  it('funciona sobre un documento cuya xref es un xref-stream (PDF 1.5+)', async () => {
    const uno = await makeVault('FIRMANTE UNO', '1111111111')
    const dos = await makeVault('FIRMANTE DOS', '2222222222')

    // Documento firmado por "otra herramienta" que sí usa object streams: su última
    // sección xref es un xref-stream, no una tabla clásica (así vienen la mayoría de
    // los PDFs modernos).
    const base = await signWithXrefStream(await samplePdf(true), uno)
    expect(bytesToBinaryString(base)).toContain('/Type /XRef')
    expect((await validatePdf(base))[0].integrityValid).toBe(true)

    const firmado = await sign(base, dos, 1)
    expect(firmado.subarray(0, base.length)).toEqual(base)
    expect((await PDFDocument.load(toArrayBuffer(firmado))).getPageCount()).toBe(1)
    // La actualización añade su propio xref-stream, no una tabla clásica.
    expect(bytesToBinaryString(firmado.subarray(base.length))).toContain('/Type /XRef')

    // Los objetos nuevos no pueden reutilizar números de la revisión anterior: los
    // object streams y el xref-stream del original ocupan números que pdf-lib no ve,
    // y pisarlos deja el catálogo irrecuperable. Lo comprobamos con pdf.js.
    expect(await pdfjsFields(firmado)).toEqual(['Signature1', 'Signature2'])

    const reports = await validatePdf(firmado)
    expect(reports.map((r) => r.signerName)).toEqual(['FIRMANTE UNO', 'FIRMANTE DOS'])
    expect(reports.every((r) => r.integrityValid)).toBe(true)
  }, 60000)
})

/** Abre el PDF con pdf.js (el visor real de la app) y devuelve los campos de firma. */
async function pdfjsFields(pdfBytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: pdfBytes.slice(), useSystemFonts: false }).promise
  const fields = await doc.getFieldObjects()
  return Object.keys(fields ?? {}).sort()
}

/** Firma como otra herramienta que guarda con object streams (deja un xref-stream). */
async function signWithXrefStream(pdfBytes: Uint8Array, vault: UnlockedVault): Promise<Uint8Array> {
  const doc = await PDFDocument.load(toArrayBuffer(pdfBytes))
  pdflibAddPlaceholder({
    pdfDoc: doc,
    pdfPage: doc.getPages()[0],
    reason: 'Prueba',
    contactInfo: '',
    name: vault.subject.commonName,
    location: 'Ecuador',
    signatureLength: 8192,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    widgetRect: [0, 0, 0, 0],
  })
  const withPlaceholder = await doc.save({ useObjectStreams: true })
  const signed = await new SignPdf().sign(
    Buffer.from(withPlaceholder),
    new WebCryptoPadesSigner(vault),
  )
  return new Uint8Array(signed)
}
