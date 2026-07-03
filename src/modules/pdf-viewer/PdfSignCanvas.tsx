import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { ChevronLeft, ChevronRight, FileWarning, RotateCcw } from 'lucide-react'
import { loadPdf, type LoadedPdf } from './pdfjs'
import { useContainerWidth } from './useContainerWidth'
import { StampPreview, useStampDims } from './StampPreview'
import { Skeleton } from '../../components/ui'
import type { SignaturePosition, SignatureAppearance } from '../pdf-signer'

interface Props {
  pdfBytes: Uint8Array
  onPositionChange: (pos: SignaturePosition) => void
  /** Apariencia real del sello, para previsualizarlo idéntico dentro del recuadro. */
  preview?: SignatureAppearance
}

/**
 * Previsualiza el PDF y permite ARRASTRAR (no redimensionar) un recuadro de tamaño
 * fijo. La posición (px de pantalla) se convierte a puntos PDF (origen abajo-izq).
 */
export function PdfSignCanvas({ pdfBytes, onPositionChange, preview }: Props) {
  const [outerRef, outerWidth] = useContainerWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [pos, setPos] = useState({ x: 24, y: 24 })

  // Tamaño del sello en puntos PDF, ajustado al contenido (no redimensionable;
  // solo se arrastra), y su equivalente en px de pantalla.
  const { width: sigW, height: sigH } = useStampDims(preview)
  const boxW = sigW * scale
  const boxH = sigH * scale

  useEffect(() => {
    let active = true
    let loaded: LoadedPdf | null = null
    setPdf(null)
    setLoadError(false)
    loadPdf(pdfBytes)
      .then((p) => {
        if (!active) {
          p.destroy()
          return
        }
        loaded = p
        setPdf(p)
        setPage(1)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
    return () => {
      active = false
      loaded?.destroy()
    }
  }, [pdfBytes, retryNonce])

  useEffect(() => {
    if (!pdf || !canvasRef.current || outerWidth === 0) return
    const canvas = canvasRef.current
    let cancelled = false
    pdf.getPageSize(page).then((size) => {
      if (cancelled || !canvasRef.current) return
      const fitScale = Math.min(1.6, Math.max(0.2, outerWidth / size.width))
      return pdf.renderPage(page, canvas, fitScale).then((cssSize) => {
        if (cancelled) return
        setScale(fitScale)
        setCanvasSize(cssSize)
      })
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page, outerWidth])

  const emit = useCallback(
    (p: { x: number; y: number }, pageNumber: number, canvasH: number, s: number) => {
      if (canvasH === 0 || s === 0) return
      onPositionChange({
        pageIndex: pageNumber - 1,
        x: p.x / s,
        y: (canvasH - p.y - sigH * s) / s,
        width: sigW,
        height: sigH,
      })
    },
    [onPositionChange, sigW, sigH],
  )

  // Reemite cuando cambia posición, página, canvas o escala.
  useEffect(() => {
    emit(pos, page, canvasSize.height, scale)
  }, [pos, page, canvasSize.height, scale, emit])

  return (
    <div ref={outerRef} className="flex flex-col gap-3">
      {loadError ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/10 text-amber-600">
            <FileWarning className="h-6 w-6" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-medium">No se pudo cargar la vista previa del PDF.</p>
            <p className="mt-0.5 text-xs text-slate-400">Vuelve a intentarlo.</p>
          </div>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Reintentar
          </button>
        </div>
      ) : !pdf ? (
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
                size={{ width: boxW, height: boxH }}
                position={{ x: pos.x, y: pos.y }}
                enableResizing={false}
                onDragStop={(_e, d) => setPos({ x: d.x, y: d.y })}
                className="cursor-move border border-dashed border-brand-500/70"
              >
                {/* Preview idéntico al sello real (QR + texto, mismas dimensiones, escalado). */}
                {preview && <StampPreview appearance={preview} scale={scale} />}
              </Rnd>
            )}
          </div>
        </>
      )}
    </div>
  )
}
