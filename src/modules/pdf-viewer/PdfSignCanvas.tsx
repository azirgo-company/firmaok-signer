import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { ChevronLeft, ChevronRight, QrCode } from 'lucide-react'
import { loadPdf, type LoadedPdf } from './pdfjs'
import { useContainerWidth } from './useContainerWidth'
import { Skeleton } from '../../components/ui'
import type { SignaturePosition } from '../pdf-signer'

// Tamaño FIJO del sello en puntos PDF (no redimensionable; solo se arrastra).
const SIG_W_PT = 200
const SIG_H_PT = 64

export interface SignaturePreview {
  name: string
  subline?: string
}

interface Props {
  pdfBytes: Uint8Array
  onPositionChange: (pos: SignaturePosition) => void
  /** Datos para previsualizar el sello dentro del recuadro. */
  preview?: SignaturePreview
}

/**
 * Previsualiza el PDF y permite ARRASTRAR (no redimensionar) un recuadro de tamaño
 * fijo. La posición (px de pantalla) se convierte a puntos PDF (origen abajo-izq).
 */
export function PdfSignCanvas({ pdfBytes, onPositionChange, preview }: Props) {
  const [outerRef, outerWidth] = useContainerWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [pos, setPos] = useState({ x: 24, y: 24 })

  // Tamaño del recuadro en px de pantalla (derivado del tamaño fijo en puntos).
  const boxW = SIG_W_PT * scale
  const boxH = SIG_H_PT * scale

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
    (p: { x: number; y: number }, pageNumber: number, canvasH: number, s: number) => {
      if (canvasH === 0 || s === 0) return
      onPositionChange({
        pageIndex: pageNumber - 1,
        x: p.x / s,
        y: (canvasH - p.y - SIG_H_PT * s) / s,
        width: SIG_W_PT, // tamaño fijo en puntos
        height: SIG_H_PT,
      })
    },
    [onPositionChange],
  )

  // Reemite cuando cambia posición, página, canvas o escala.
  useEffect(() => {
    emit(pos, page, canvasSize.height, scale)
  }, [pos, page, canvasSize.height, scale, emit])

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
                size={{ width: boxW, height: boxH }}
                position={{ x: pos.x, y: pos.y }}
                enableResizing={false}
                onDragStop={(_e, d) => setPos({ x: d.x, y: d.y })}
                className="flex items-center gap-1 overflow-hidden rounded border border-dashed border-brand-500 bg-white/85 px-1 text-brand-800 shadow-sm backdrop-blur-[1px] dark:bg-slate-900/85 dark:text-brand-100"
              >
                <QrCode
                  className="shrink-0"
                  style={{ width: boxH * 0.66, height: boxH * 0.66 }}
                  strokeWidth={1.5}
                />
                <span className="min-w-0 flex-1 leading-tight" style={{ fontSize: Math.max(5, boxH * 0.15) }}>
                  <span className="block truncate font-semibold">{preview?.name ?? 'Firma'}</span>
                  {preview?.subline && (
                    <span className="block truncate opacity-80">{preview.subline}</span>
                  )}
                  <span className="block truncate opacity-50">firmaok.com.ec</span>
                </span>
              </Rnd>
            )}
          </div>
        </>
      )}
    </div>
  )
}
