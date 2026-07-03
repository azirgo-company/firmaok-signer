import { useEffect, useState } from 'react'
import type { SignatureAppearance } from '../pdf-signer'
import {
  buildStampLines,
  generateQrDataUrl,
  getHelveticaMeasurer,
  stampHeight,
  stampLineColor,
  stampQrSize,
  stampWidth,
  STAMP_LEAD,
  STAMP_PAD,
  STAMP_QR_GAP,
  STAMP_WIDTH,
  STAMP_HEIGHT,
  type StampMeasure,
} from '../pdf-signer/appearance'

/** Medidor de Helvetica (para envolver la nota y medir el ancho igual que en el PDF). */
function useHelveticaMeasure(): StampMeasure | null {
  const [measure, setMeasure] = useState<StampMeasure | null>(null)
  useEffect(() => {
    getHelveticaMeasurer()
      .then((m) => setMeasure(() => m))
      .catch(() => {})
  }, [])
  return measure
}

/**
 * Dimensiones reales del sello (en puntos PDF) para una apariencia dada, ajustadas
 * al contenido. Mientras carga el medidor de fuentes cae a los máximos.
 */
export function useStampDims(appearance?: SignatureAppearance): {
  width: number
  height: number
} {
  const measure = useHelveticaMeasure()
  if (!appearance || !measure) return { width: STAMP_WIDTH, height: STAMP_HEIGHT }
  const lines = buildStampLines(appearance, new Date(), measure)
  return { width: stampWidth(lines, measure), height: stampHeight(lines) }
}

/**
 * Renderiza el sello (QR + datos del firmante) con la MISMA receta que el PDF,
 * escalado a px de pantalla. Se usa dentro del recuadro arrastrable sobre el
 * documento y como preview estático en el panel lateral de firma.
 */
export function StampPreview({
  appearance,
  scale,
}: {
  appearance: SignatureAppearance
  scale: number
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  useEffect(() => {
    generateQrDataUrl().then(setQrDataUrl).catch(() => {})
  }, [])

  const measure = useHelveticaMeasure()

  const lines = buildStampLines(appearance, new Date(), measure ?? undefined)
  const qrSize = stampQrSize(lines)
  const width = stampWidth(lines, measure ?? undefined)
  const height = stampHeight(lines)

  // Se renderiza internamente a 4× y se reduce con transform: los navegadores
  // móviles imponen tamaños mínimos / escalado de accesibilidad a fuentes muy
  // pequeñas y recortaban las letras; el transform no está sujeto a eso.
  const rs = 4

  return (
    <div style={{ width: width * scale, height: height * scale, overflow: 'hidden' }}>
      <div
        className="flex items-center text-left"
        style={{
          width: width * rs,
          height: height * rs,
          paddingLeft: STAMP_PAD * rs,
          paddingRight: STAMP_PAD * rs,
          gap: STAMP_QR_GAP * rs,
          transform: `scale(${scale / rs})`,
          transformOrigin: 'top left',
        }}
      >
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt=""
            className="shrink-0"
            style={{ width: qrSize * rs, height: qrSize * rs }}
          />
        )}
        <div className="flex min-w-0 flex-col justify-center" style={{ gap: STAMP_LEAD * rs }}>
          {lines.map((l, i) => (
            <span
              key={i}
              className={`block truncate ${l.bold ? 'font-bold' : ''}`}
              style={{
                fontSize: l.size * rs,
                lineHeight: 1,
                color: stampLineColor(l.faded),
              }}
            >
              {l.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
