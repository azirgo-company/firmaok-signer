import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib'
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
import { hasSignature, prepareIncremental, saveIncremental } from './incremental'

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
 * Firma un PDF con una firma PAdES-B visible. Si el documento ya venía firmado, la
 * nueva firma se AÑADE mediante actualización incremental: los bytes originales no se
 * tocan, así que las firmas previas conservan su validez (multifirma).
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

  // Sobre un documento ya firmado hay que trabajar en incremental; sobre uno limpio
  // se reescribe entero (produce un archivo más compacto y tolera PDFs con el xref
  // roto, que pdf-lib repara al cargarlos).
  const incremental = hasSignature(req.pdfBytes)

  const pdfDoc = await PDFDocument.load(toArrayBuffer(req.pdfBytes), {
    // En incremental evitamos tocar el /Info: cuanto menor sea el delta añadido,
    // menos "cambios posteriores a la firma" reportan los visores.
    updateMetadata: !incremental,
  })
  const base = incremental ? prepareIncremental(pdfDoc, req.pdfBytes) : undefined

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
    // Dirección del certificado (esquema EC .3.7/.3.9 o localidad del DN). Si la AC no la
    // trae, caemos a la razón social (lo que se usaba antes de leer la dirección) y, en
    // último caso, "Ecuador": el /Location no puede quedar vacío.
    location: req.appearance.location ?? req.appearance.companyName ?? 'Ecuador',
    signingTime,
    signatureLength: SIGNATURE_LENGTH,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    // Widget invisible (rect 0×0): el sello visible ya está dibujado en el
    // contenido de la página. Un widget del tamaño del sello hace que varios
    // visores (Drive, Adobe móvil) lo pinten con el resaltado celeste de
    // campos de formulario, porque su stream de apariencia va vacío.
    widgetRect: [0, 0, 0, 0],
  })
  renameNewFieldIfTaken(pdfDoc)

  const withPlaceholder =
    base ?
      await saveIncremental(pdfDoc, req.pdfBytes, base)
    : await pdfDoc.save({ useObjectStreams: false })

  const signer = new WebCryptoPadesSigner(req.vault)
  const signed = await new SignPdf().sign(Buffer.from(withPlaceholder), signer, signingTime)
  return new Uint8Array(signed)
}

/**
 * @signpdf nombra SIEMPRE "Signature1" al campo que crea. Si el PDF ya traía un campo
 * con ese nombre (lo habitual al refirmar), quedarían dos campos con el mismo nombre
 * completo, que según ISO 32000-1 §12.7.3.2 son el MISMO campo y comparten valor: los
 * visores muestran una sola firma. Le damos el primer "SignatureN" libre.
 */
function renameNewFieldIfTaken(pdfDoc: PDFDocument): void {
  const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (!fields || fields.size() < 2) return

  const used = new Set<string>()
  for (let i = 0; i < fields.size() - 1; i++) {
    const name = fieldName(pdfDoc, fields.get(i))
    if (name) used.add(name)
  }
  if (!used.size) return

  const widget = pdfDoc.context.lookupMaybe(fields.get(fields.size() - 1), PDFDict)
  if (!widget) return

  let n = 1
  while (used.has(`Signature${n}`)) n++
  widget.set(PDFName.of('T'), PDFString.of(`Signature${n}`))
}

function fieldName(pdfDoc: PDFDocument, ref: unknown): string | undefined {
  const dict = pdfDoc.context.lookupMaybe(ref as never, PDFDict)
  const title = dict?.get(PDFName.of('T'))
  if (title instanceof PDFString || title instanceof PDFHexString) return title.decodeText()
  return undefined
}
