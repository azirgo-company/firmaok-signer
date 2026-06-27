import { PDFDocument } from 'pdf-lib'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { SignPdf } from '@signpdf/signpdf'
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils'
import { toArrayBuffer } from '../../lib/bytes'
import type { UnlockedVault } from '../cert-vault/vault'
import { WebCryptoPadesSigner } from './signer'
import {
  drawSignatureAppearance,
  type SignatureAppearance,
  type SignaturePosition,
} from './appearance'

export type { SignatureAppearance, SignaturePosition } from './appearance'

// Holgura generosa para el /Contents: el CMS con cadena completa puede pasar de 8 KB.
const SIGNATURE_LENGTH = 24576

export interface SignPdfRequest {
  pdfBytes: Uint8Array
  vault: UnlockedVault
  appearance: SignatureAppearance
  position: SignaturePosition
  /** Hora declarada de firma (offline estricto: hora local del dispositivo). */
  signingTime?: Date
}

/**
 * Firma un PDF con una firma PAdES-B visible. Soporta firmar un PDF ya firmado
 * (añade un nuevo campo de firma); para conservar la validez criptográfica de
 * firmas previas se requiere actualización incremental (ver nota de multifirma).
 */
export async function signPdf(req: SignPdfRequest): Promise<Uint8Array> {
  const signingTime = req.signingTime ?? new Date()

  // No se permite firmar con un certificado fuera de su periodo de validez.
  if (req.vault.validTo.getTime() < signingTime.getTime()) {
    throw new Error('El certificado está vencido; no se puede usar para firmar.')
  }
  if (req.vault.validFrom.getTime() > signingTime.getTime()) {
    throw new Error('El certificado aún no es válido (su vigencia no ha comenzado).')
  }

  const pdfDoc = await PDFDocument.load(toArrayBuffer(req.pdfBytes))

  const pages = pdfDoc.getPages()
  if (req.position.pageIndex < 0 || req.position.pageIndex >= pages.length) {
    throw new Error('La página seleccionada para la firma no existe.')
  }
  const page = pages[req.position.pageIndex]

  await drawSignatureAppearance(pdfDoc, page, req.appearance, req.position, signingTime)

  pdflibAddPlaceholder({
    pdfDoc,
    pdfPage: page,
    reason: 'Firmado digitalmente con FirmaOK · firmaok.com.ec',
    contactInfo: req.appearance.identification ?? '',
    name: req.appearance.name,
    location: req.appearance.companyName ?? 'Ecuador',
    signingTime,
    signatureLength: SIGNATURE_LENGTH,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    widgetRect: [
      req.position.x,
      req.position.y,
      req.position.x + req.position.width,
      req.position.y + req.position.height,
    ],
  })

  const withPlaceholder = await pdfDoc.save({ useObjectStreams: false })

  const signer = new WebCryptoPadesSigner(req.vault)
  const signed = await new SignPdf().sign(Buffer.from(withPlaceholder), signer, signingTime)
  return new Uint8Array(signed)
}
