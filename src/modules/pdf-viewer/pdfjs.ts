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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Rechaza si `p` no se resuelve a tiempo (sin dejar promesas colgando). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('pdf-worker-timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

type PdfWorker = InstanceType<typeof pdfjsLib.PDFWorker>

/**
 * Devuelve un worker de pdf.js ya inicializado. La PRIMERA vez que se instancia
 * —justo cuando el service worker toma control de la página (clientsClaim) y aún
 * está precacheando el .mjs del worker— su arranque puede quedarse colgado. En ese
 * caso reintentamos con un pequeño backoff: es el equivalente automático a "recargar
 * y volver a subir el PDF", pero invisible para el usuario. Si tras varios intentos
 * no arranca, devolvemos null y dejamos que getDocument use su worker por defecto.
 */
async function readyWorker(): Promise<PdfWorker | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const worker = new pdfjsLib.PDFWorker()
    try {
      await withTimeout(worker.promise, 4000)
      return worker
    } catch {
      worker.destroy()
      await delay(300 * (attempt + 1))
    }
  }
  return null
}

/** Carga un PDF con pdf.js para previsualización/render local. */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const worker = await readyWorker()
  // pdf.js puede transferir/detachar el buffer; le pasamos una copia.
  let doc
  try {
    doc = await pdfjsLib.getDocument({
      data: bytes.slice(),
      worker: worker ?? undefined,
    }).promise
  } catch (err) {
    // Si el parseo falla (p. ej. PDF corrupto), liberamos el worker que creamos.
    worker?.destroy()
    throw err
  }

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
      // Si nosotros creamos el worker, también lo liberamos (pdf.js no lo hace por
      // nosotros cuando se lo pasamos explícitamente).
      worker?.destroy()
    },
  }
}
