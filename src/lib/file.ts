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

/** true si el navegador puede abrir la hoja nativa de compartir con este archivo (móvil). */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

/**
 * Comparte el archivo con la hoja nativa del sistema. Así el PDF llega como
 * adjunto real (sin URL blob: pegada como texto, que fuera de este navegador
 * es un enlace muerto). Cancelar la hoja no se considera error.
 */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] })
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return
    throw e
  }
}
