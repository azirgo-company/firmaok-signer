import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib'

/** Posición del recuadro de firma, en puntos PDF (origen abajo-izquierda). */
export interface SignaturePosition {
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

/** Contenido visible del recuadro de firma (estilo FirmaEC). */
export interface SignatureAppearance {
  name: string
  identification?: string
  reason?: string
  location?: string
  /** Logo opcional en PNG. */
  logoPng?: Uint8Array
}

/**
 * Dibuja el recuadro de firma visible sobre la página. Lo que se dibuja queda como
 * apariencia del campo de firma colocado encima por el placeholder.
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

  page.drawRectangle({
    x: pos.x,
    y: pos.y,
    width: pos.width,
    height: pos.height,
    borderColor: rgb(0.15, 0.39, 0.92),
    borderWidth: 1,
    color: rgb(0.97, 0.98, 1),
    opacity: 0.9,
  })

  const pad = 6
  let textX = pos.x + pad
  const textWidth = pos.width - pad * 2

  // Logo opcional a la izquierda.
  if (appearance.logoPng) {
    try {
      const logo = await pdfDoc.embedPng(appearance.logoPng)
      const logoH = pos.height - pad * 2
      const logoW = (logo.width / logo.height) * logoH
      page.drawImage(logo, { x: pos.x + pad, y: pos.y + pad, width: logoW, height: logoH })
      textX = pos.x + pad + logoW + pad
    } catch {
      // Si el logo falla, seguimos solo con texto.
    }
  }

  const lines: Array<{ text: string; bold?: boolean }> = [
    { text: `Firmado por:`, bold: false },
    { text: appearance.name, bold: true },
  ]
  if (appearance.identification) lines.push({ text: `ID: ${appearance.identification}` })
  if (appearance.reason) lines.push({ text: `Razón: ${appearance.reason}` })
  if (appearance.location) lines.push({ text: `Lugar: ${appearance.location}` })
  lines.push({ text: `Fecha: ${formatDate(signingTime)}` })

  const size = 7
  const lineGap = (pos.height - pad * 2) / lines.length
  let cursorY = pos.y + pos.height - pad - size
  for (const line of lines) {
    const f = line.bold ? fontBold : font
    const text = truncate(sanitizeForPdf(line.text), textWidth, f, size)
    drawSafeText(page, text, { x: textX, y: cursorY, size, font: f, color: rgb(0.1, 0.12, 0.16) })
    cursorY -= lineGap
  }
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
