/** Lee un File del input como Uint8Array. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/** Dispara la descarga local de unos bytes (no sale del dispositivo). */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Envuelve unos bytes como File con nombre y tipo correctos (para compartir). */
export function makePdfFile(bytes: Uint8Array, filename: string, mime = 'application/pdf'): File {
  return new File([bytes as BlobPart], filename, { type: mime })
}

/**
 * true si el navegador puede abrir la hoja nativa de compartir con archivos PDF.
 * Soportado en iOS Safari 15+, Chrome/Edge Android y Chrome/Edge de escritorio
 * (Windows/macOS). Se sondea con un File dummy porque canShare exige uno real.
 */
export function canSharePdfFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  const probe = new File([new Uint8Array([0x25])], 'probe.pdf', { type: 'application/pdf' })
  return navigator.canShare({ files: [probe] })
}

/**
 * Comparte el archivo con la hoja nativa del sistema. Así el PDF llega como
 * adjunto real (sin URL blob: pegada como texto, que fuera de este navegador
 * es un enlace muerto). `text` acompaña al archivo donde el destino lo admita
 * (WhatsApp/Telegram lo muestran como mensaje junto al documento). Cancelar
 * la hoja no se considera error.
 */
export async function shareFile(file: File, text?: string): Promise<void> {
  const withText: ShareData = text ? { files: [file], text } : { files: [file] }
  // Si el navegador no admite archivo+texto juntos, comparte solo el archivo.
  const data =
    typeof navigator.canShare === 'function' && !navigator.canShare(withText)
      ? { files: [file] }
      : withText
  try {
    await navigator.share(data)
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return
    throw e
  }
}
