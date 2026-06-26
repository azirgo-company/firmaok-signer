import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { loadPdf, type LoadedPdf } from './pdfjs'
import { useContainerWidth } from './useContainerWidth'
import { Skeleton } from '../../components/ui'

interface Props {
  pdfBytes: Uint8Array
  /** Ancho MÁXIMO en px; se reduce si el contenedor es más estrecho (responsive). */
  width?: number
}

/** Previsualización del PDF con navegación de páginas (solo lectura, responsive). */
export function PdfThumbnail({ pdfBytes, width = 360 }: Props) {
  const [outerRef, outerWidth] = useContainerWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const targetWidth = Math.max(120, Math.min(width, outerWidth || width))

  useEffect(() => {
    let active = true
    let loaded: LoadedPdf | null = null
    setPdf(null)
    setSize({ width: 0, height: 0 })
    loadPdf(pdfBytes).then((p) => {
      if (!active) {
        p.destroy()
        return
      }
      loaded = p
      setPdf(p)
      setPage(1)
    })
    return () => {
      active = false
      loaded?.destroy()
    }
  }, [pdfBytes])

  useEffect(() => {
    if (!pdf || !canvasRef.current || outerWidth === 0) return
    const canvas = canvasRef.current
    let cancelled = false
    pdf.getPageSize(page).then((dims) => {
      if (cancelled || !canvasRef.current) return
      return pdf.renderPage(page, canvas, targetWidth / dims.width).then(() => {
        if (!cancelled) setSize({ width: canvas.width, height: canvas.height })
      })
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page, targetWidth, outerWidth])

  const loaded = size.height > 0

  return (
    <div ref={outerRef} className="flex w-full flex-col items-center gap-2">
      {!loaded && <Skeleton className="aspect-[1/1.3] w-full rounded-xl" />}
      <div
        className={`mx-auto max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 ${loaded ? '' : 'hidden'}`}
        style={loaded ? { width: size.width, height: size.height } : undefined}
      >
        <canvas ref={canvasRef} className="block" />
      </div>

      {pdf && pdf.numPages > 1 && loaded && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
          <span className="font-medium tabular-nums text-slate-600 dark:text-slate-300">
            {page} / {pdf.numPages}
          </span>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
            onClick={() => setPage((p) => Math.min(pdf.numPages, p + 1))}
            disabled={page >= pdf.numPages}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  )
}
