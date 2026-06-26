import * as pdfjsLib from 'pdfjs-dist'

// El worker de pdf.js se sirve como asset local y queda precacheado por el SW (offline).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjsLib }

export interface LoadedPdf {
  numPages: number
  getPageSize(pageNumber: number): Promise<{ width: number; height: number }>
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void>
  destroy(): void
}

/** Carga un PDF con pdf.js para previsualización/render local. */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  // pdf.js puede transferir/detachar el buffer; le pasamos una copia.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise

  return {
    numPages: doc.numPages,
    async getPageSize(pageNumber) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      return { width: viewport.width, height: viewport.height }
    },
    async renderPage(pageNumber, canvas, scale) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo obtener el contexto del canvas.')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
    },
    destroy() {
      void (doc as { destroy?: () => void }).destroy?.()
    },
  }
}
