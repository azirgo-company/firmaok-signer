import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { ChevronLeft, ChevronRight, PenLine } from 'lucide-react'
import { loadPdf, type LoadedPdf } from './pdfjs'
import { useContainerWidth } from './useContainerWidth'
import { Skeleton } from '../../components/ui'
import type { SignaturePosition } from '../pdf-signer'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  pdfBytes: Uint8Array
  onPositionChange: (pos: SignaturePosition) => void
}

/**
 * Previsualiza el PDF y permite arrastrar/redimensionar el recuadro de firma.
 * El render se ajusta al ancho disponible (responsive). Convierte la posición
 * (px de pantalla) a puntos PDF (origen abajo-izquierda) usando la escala real.
 */
export function PdfSignCanvas({ pdfBytes, onPositionChange }: Props) {
  const [outerRef, outerWidth] = useContainerWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [box, setBox] = useState<Box>({ x: 24, y: 24, width: 240, height: 84 })

  useEffect(() => {
    let active = true
    let loaded: LoadedPdf | null = null
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
    pdf.getPageSize(page).then((size) => {
      if (cancelled || !canvasRef.current) return
      // Ajusta el ancho del PDF al contenedor (cap 1.6 para no agrandar en desktop).
      const fitScale = Math.min(1.6, Math.max(0.2, outerWidth / size.width))
      return pdf.renderPage(page, canvas, fitScale).then(() => {
        if (cancelled) return
        setScale(fitScale)
        setCanvasSize({ width: canvas.width, height: canvas.height })
      })
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page, outerWidth])

  const emit = useCallback(
    (next: Box, pageNumber: number, height: number, s: number) => {
      if (height === 0 || s === 0) return
      onPositionChange({
        pageIndex: pageNumber - 1,
        x: next.x / s,
        y: (height - next.y - next.height) / s,
        width: next.width / s,
        height: next.height / s,
      })
    },
    [onPositionChange],
  )

  // Reemite la posición cuando cambia el recuadro, la página, el canvas o la escala.
  useEffect(() => {
    emit(box, page, canvasSize.height, scale)
  }, [box, page, canvasSize.height, scale, emit])

  // Wrapper estable: el ref permanece en el mismo nodo entre estados (carga / listo),
  // para que el ResizeObserver mida siempre el contenedor correcto.
  return (
    <div ref={outerRef} className="flex flex-col gap-3">
      {!pdf ? (
        <div className="flex flex-col items-center gap-3 p-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="aspect-[1/1.3] w-full max-w-md rounded-lg" />
        </div>
      ) : (
        <>
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        </button>
        <span className="text-sm font-medium tabular-nums text-slate-600 dark:text-slate-300">
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

      <div
        className="relative mx-auto max-w-full overflow-hidden rounded-lg border border-slate-200 shadow-sm dark:border-slate-700"
        style={{ width: canvasSize.width, height: canvasSize.height }}
      >
        <canvas ref={canvasRef} className="block" />
        {canvasSize.height > 0 && (
          <Rnd
            bounds="parent"
            size={{ width: box.width, height: box.height }}
            position={{ x: box.x, y: box.y }}
            minWidth={120}
            minHeight={50}
            onDragStop={(_e, d) => setBox((b) => ({ ...b, x: d.x, y: d.y }))}
            onResizeStop={(_e, _dir, ref, _delta, pos) =>
              setBox({
                x: pos.x,
                y: pos.y,
                width: parseFloat(ref.style.width),
                height: parseFloat(ref.style.height),
              })
            }
            className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-brand-500 bg-brand-500/10 text-xs font-semibold text-brand-700 backdrop-blur-[1px] dark:text-brand-100"
          >
            <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
            Firma aquí
          </Rnd>
        )}
      </div>
        </>
      )}
    </div>
  )
}
