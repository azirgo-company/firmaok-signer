import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import { base64ToBytes } from '../../lib/bytes'

/** Posición del recuadro de firma, en puntos PDF (origen abajo-izquierda). */
export interface SignaturePosition {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

/** Contenido visible del recuadro de firma (QR + datos del firmante). */
export interface SignatureAppearance {
  name: string
  identification?: string
  /** Datos de empresa (cuando el firmante es persona jurídica / representante). */
  isCompany?: boolean
  companyName?: string
  position?: string
  companyRuc?: string
}

/** Enlace que codifica el QR del sello. */
export const VERIFY_URL = 'https://firmaok.com.ec/'

interface Line {
  text: string
  size: number
  bold?: boolean
  faded?: boolean
}

/**
 * Dibuja el recuadro de firma visible: QR (enlace de FirmaOK) a la izquierda y los
 * datos del firmante a la derecha. Para persona jurídica muestra razón social,
 * cargo y RUC de la empresa.
 */
export async function drawSignatureAppearance(
  pdfDoc: PDFDocument,
  page: PDFPage,
  appearance: SignatureAppearance,
  pos: SignaturePosition,
  signingTime: Date,
): Promise<void> {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Sin recuadro ni fondo: solo QR + texto, transparente sobre el documento.
  const pad = 3

  // QR a la izquierda, pequeño y centrado verticalmente.
  const qrSize = Math.min(pos.height - pad * 2, 42)
  let textX = pos.x + pad
  try {
    const qrPng = await generateQrPng(VERIFY_URL)
    const qr = await pdfDoc.embedPng(qrPng)
    const qrY = pos.y + (pos.height - qrSize) / 2
    page.drawImage(qr, { x: pos.x + pad, y: qrY, width: qrSize, height: qrSize })
    textX = pos.x + pad + qrSize + 4
  } catch {
    // Si el QR falla, seguimos solo con texto.
  }

  const textWidth = pos.x + pos.width - pad - textX

  // Líneas de texto: muy pequeñas y ajustadas.
  const lines: Line[] = [{ text: appearance.name, size: 4, bold: true }]
  if (appearance.isCompany) {
    if (appearance.companyName) lines.push({ text: appearance.companyName, size: 3.6, bold: true })
    if (appearance.position) lines.push({ text: appearance.position, size: 3.4 })
    if (appearance.companyRuc) lines.push({ text: `RUC ${appearance.companyRuc}`, size: 3.4 })
  } else if (appearance.identification) {
    lines.push({ text: `CI ${appearance.identification}`, size: 3.4 })
  }
  lines.push({ text: formatDate(signingTime), size: 3.4 })
  lines.push({ text: 'Firmado con firmaok.com.ec', size: 3.1, faded: true })

  // Bloque de texto compacto (interlineado fijo) y centrado verticalmente.
  const lead = 1.1
  const blockH = lines.reduce((n, l) => n + l.size + lead, 0) - lead
  let cursorY = pos.y + (pos.height + blockH) / 2
  for (const line of lines) {
    cursorY -= line.size
    const f = line.bold ? fontBold : font
    const color = line.faded ? rgb(0.45, 0.5, 0.58) : rgb(0.1, 0.12, 0.16)
    const text = truncate(sanitizeForPdf(line.text), textWidth, f, line.size)
    drawSafeText(page, text, { x: textX, y: cursorY, size: line.size, font: f, color })
    cursorY -= lead
  }
}

async function generateQrPng(text: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(text, {
    margin: 0, // sin zona de silencio ("filos")
    width: 220,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172aff', light: '#00000000' }, // fondo transparente
  })
  return base64ToBytes(dataUrl.split(',')[1] ?? '')
}

/**
 * La fuente estándar (WinAnsi) no puede codificar caracteres de control ni fuera de
 * Latin-1. Quitamos controles C0/C1 (origen de errores como 0x0091) para evitar crashes.
 */
function sanitizeForPdf(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

/** Dibuja texto; si algún carácter no es codificable en WinAnsi, cae a una versión ASCII. */
function drawSafeText(
  page: PDFPage,
  text: string,
  opts: Parameters<PDFPage['drawText']>[1],
): void {
  try {
    page.drawText(text, opts)
  } catch {
    page.drawText(text.replace(/[^\x20-\x7e]/g, '?'), opts)
  }
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function truncate(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1)
  return t + '…'
}
