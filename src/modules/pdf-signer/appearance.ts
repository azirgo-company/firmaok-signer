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
  /** Añade la fecha/hora de firma al sello. Por defecto no se muestra. */
  includeDate?: boolean
  /** Nota libre del firmante (máximo 2 líneas) mostrada en el sello. */
  notes?: string
}

/** Divide las notas en un máximo de 2 líneas no vacías (para el sello y el preview). */
export function noteLines(notes?: string): string[] {
  if (!notes) return []
  return notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
}

/** Enlace que codifica el QR del sello. */
export const VERIFY_URL = 'https://firmaok.com.ec/'

// Receta del sello (compartida entre el PDF real y el preview en pantalla).
export const STAMP_PAD = 6
export const STAMP_LEAD = 2.2
export const STAMP_QR_GAP = 8
// Dimensiones fijas del sello en puntos PDF (coinciden con el recuadro del preview).
export const STAMP_WIDTH = 350
export const STAMP_HEIGHT = 96
// Tope del QR: la altura útil del sello.
export const STAMP_QR_MAX = STAMP_HEIGHT - STAMP_PAD * 2

/** Tamaño del QR del sello: 1.5× el alto del bloque de texto (igual en PDF y preview). */
export function stampQrSize(lines: StampLine[]): number {
  return Math.min(stampBlockHeight(lines) * 1.5, STAMP_QR_MAX)
}
// Tamaño de fuente de las líneas de nota.
export const STAMP_NOTE_SIZE = 6.6

// Medidor de ancho con las métricas REALES de Helvetica, cacheado. Se usa tanto en
// el PDF como en el preview para que las notas se envuelvan exactamente igual.
let helveticaMeasurer: Promise<(text: string, size: number) => number> | null = null
export function getHelveticaMeasurer(): Promise<(text: string, size: number) => number> {
  if (!helveticaMeasurer) {
    helveticaMeasurer = (async () => {
      const doc = await PDFDocument.create()
      const font = await doc.embedFont(StandardFonts.Helvetica)
      return (text: string, size: number) => font.widthOfTextAtSize(text, size)
    })()
  }
  return helveticaMeasurer
}

/**
 * Envuelve `text` en como máximo `maxLines` líneas que quepan en `maxWidth`,
 * midiendo con `measure`. Rompe por espacios y, si una palabra no cabe, por
 * caracteres (para textos sin espacios). La última línea se recorta con «…».
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (t: string) => number,
  maxLines: number,
): string[] {
  const fits = (t: string) => measure(t) <= maxWidth
  const lines: string[] = []
  let line = ''

  for (const word of text.split(' ').filter(Boolean)) {
    let w = word
    // Palabra más larga que el ancho disponible: partir por caracteres.
    while (!fits(w)) {
      let i = w.length
      while (i > 1 && !fits(w.slice(0, i))) i--
      if (i >= w.length) break // salvaguarda (ancho ~0)
      if (line) lines.push(line)
      lines.push(w.slice(0, i))
      line = ''
      w = w.slice(i)
    }
    if (!w) continue
    const candidate = line ? `${line} ${w}` : w
    if (fits(candidate)) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)

  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 0 && !fits(`${last}…`)) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last}…`
  return kept
}

export interface StampLine {
  text: string
  size: number
  bold?: boolean
  faded?: boolean
}

/**
 * Construye las líneas de texto del sello (mismo orden y tamaños en PDF y preview).
 * Si se pasa `measure` (métricas de Helvetica), la nota se envuelve por ancho a un
 * máximo de 2 líneas usando todo el espacio a la derecha del QR; sin `measure` cae
 * al modo simple (líneas separadas por saltos, recortadas por el renderizador).
 */
export function buildStampLines(
  a: SignatureAppearance,
  signingTime: Date,
  measure?: (text: string, size: number) => number,
): StampLine[] {
  const head: StampLine[] = [{ text: a.name, size: 8, bold: true }]
  if (a.isCompany) {
    if (a.companyName) head.push({ text: a.companyName, size: 7.2, bold: true })
    if (a.position) head.push({ text: a.position, size: 6.8 })
    if (a.companyRuc) head.push({ text: `RUC ${a.companyRuc}`, size: 6.8 })
  } else if (a.identification) {
    head.push({ text: `CI ${a.identification}`, size: 6.8 })
  }
  if (a.includeDate) head.push({ text: formatDate(signingTime), size: 6.8 })

  const footer: StampLine = { text: 'Firmado con firmaok.com.ec', size: 6.2, faded: true }

  const notesText = (a.notes ?? '').replace(/\s+/g, ' ').trim()
  if (!notesText) return [...head, footer]

  let noteTexts: string[]
  if (measure) {
    // Ancho a la derecha del QR asumiendo 2 líneas de nota (el máximo).
    const stub: StampLine = { text: '', size: STAMP_NOTE_SIZE }
    const qrSize = stampQrSize([...head, stub, stub, footer])
    const textWidth = STAMP_WIDTH - STAMP_PAD * 2 - qrSize - STAMP_QR_GAP
    noteTexts = wrapText(notesText, textWidth, (t) => measure(t, STAMP_NOTE_SIZE), 2)
  } else {
    noteTexts = noteLines(a.notes)
  }

  return [
    ...head,
    ...noteTexts.map((text) => ({ text, size: STAMP_NOTE_SIZE })),
    footer,
  ]
}

/** Alto del bloque de texto (también es el tamaño del QR). */
export function stampBlockHeight(lines: StampLine[]): number {
  return lines.reduce((n, l) => n + l.size + STAMP_LEAD, 0) - STAMP_LEAD
}

/** Color de cada línea, igual en PDF y preview. */
export function stampLineColor(faded?: boolean): string {
  return faded ? '#737d8c' : '#1a1f29'
}

/** Genera el QR del sello como data URL PNG (reutilizable para preview y para el PDF). */
export async function generateQrDataUrl(): Promise<string> {
  return QRCode.toDataURL(VERIFY_URL, {
    margin: 0,
    width: 512,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172aff', light: '#00000000' },
  })
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
  const pad = STAMP_PAD
  const lines = buildStampLines(appearance, signingTime, (t, size) =>
    font.widthOfTextAtSize(t, size),
  )
  const blockH = stampBlockHeight(lines)

  // QR del MISMO alto que el texto, centrado verticalmente.
  const qrSize = Math.min(stampQrSize(lines), pos.height - pad * 2)
  let textX = pos.x + pad
  try {
    const dataUrl = await generateQrDataUrl()
    const qr = await pdfDoc.embedPng(base64ToBytes(dataUrl.split(',')[1] ?? ''))
    const qrY = pos.y + (pos.height - qrSize) / 2
    page.drawImage(qr, { x: pos.x + pad, y: qrY, width: qrSize, height: qrSize })
    textX = pos.x + pad + qrSize + STAMP_QR_GAP
  } catch {
    // Si el QR falla, seguimos solo con texto.
  }

  const textWidth = pos.x + pos.width - pad - textX

  // Texto centrado verticalmente (misma altura que el QR).
  let cursorY = pos.y + (pos.height + blockH) / 2
  for (const line of lines) {
    cursorY -= line.size
    const f = line.bold ? fontBold : font
    const color = line.faded ? rgb(0.45, 0.5, 0.58) : rgb(0.1, 0.12, 0.16)
    const text = truncate(sanitizeForPdf(line.text), textWidth, f, line.size)
    drawSafeText(page, text, { x: textX, y: cursorY, size: line.size, font: f, color })
    cursorY -= STAMP_LEAD
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
