import { useCallback, useEffect, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { ChevronLeft, ChevronRight, FileWarning, RotateCcw } from 'lucide-react'
import { loadPdf, type LoadedPdf } from './pdfjs'
import { useContainerWidth } from './useContainerWidth'
import { Skeleton } from '../../components/ui'
import type { SignaturePosition, SignatureAppearance } from '../pdf-signer'
import {
  buildStampLines,
  generateQrDataUrl,
  getHelveticaMeasurer,
  stampBlockHeight,
  stampLineColor,
  STAMP_LEAD,
  STAMP_PAD,
  STAMP_QR_GAP,
  STAMP_WIDTH,
  STAMP_HEIGHT,
} from '../pdf-signer/appearance'

// Tamaño FIJO del sello en puntos PDF (no redimensionable; solo se arrastra).
const SIG_W_PT = STAMP_WIDTH
const SIG_H_PT = STAMP_HEIGHT

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

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  useEffect(() => {
    generateQrDataUrl().then(setQrDataUrl).catch(() => {})
  }, [])

  // Medidor de Helvetica (para envolver la nota igual que en el PDF); carga async.
  const [measure, setMeasure] = useState<((t: string, size: number) => number) | null>(null)
  useEffect(() => {
    getHelveticaMeasurer()
      .then((m) => setMeasure(() => m))
      .catch(() => {})
  }, [])

  // Tamaño del recuadro en px de pantalla (derivado del tamaño fijo en puntos).
  const boxW = SIG_W_PT * scale
  const boxH = SIG_H_PT * scale

  // Receta del sello (idéntica al PDF), escalada a px de pantalla.
  const lines = preview ? buildStampLines(preview, new Date(), measure ?? undefined) : []
  const blockH = stampBlockHeight(lines)

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
                <div
                  className="flex h-full items-center"
                  style={{
                    paddingLeft: STAMP_PAD * scale,
                    paddingRight: STAMP_PAD * scale,
                    gap: STAMP_QR_GAP * scale,
                  }}
                >
                  {qrDataUrl && (
                    <img
                      src={qrDataUrl}
                      alt=""
                      className="shrink-0"
                      style={{ width: blockH * scale, height: blockH * scale }}
                    />
                  )}
                  <div
                    className="flex min-w-0 flex-col justify-center"
                    style={{ gap: STAMP_LEAD * scale }}
                  >
                    {lines.map((l, i) => (
                      <span
                        key={i}
                        className={`block truncate ${l.bold ? 'font-bold' : ''}`}
                        style={{
                          fontSize: l.size * scale,
                          lineHeight: 1,
                          color: stampLineColor(l.faded),
                        }}
                      >
                        {l.text}
                      </span>
                    ))}
                  </div>
                </div>
              </Rnd>
            )}
          </div>
        </>
      )}
    </div>
  )
}
