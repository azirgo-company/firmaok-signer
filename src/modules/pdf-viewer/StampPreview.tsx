import { useEffect, useState } from 'react'
import type { SignatureAppearance } from '../pdf-signer'
import {
  buildStampLines,
  generateQrDataUrl,
  getHelveticaMeasurer,
  stampLineColor,
  stampQrSize,
  STAMP_LEAD,
  STAMP_PAD,
  STAMP_QR_GAP,
  STAMP_WIDTH,
  STAMP_HEIGHT,
} from '../pdf-signer/appearance'

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

  // Medidor de Helvetica (para envolver la nota igual que en el PDF); carga async.
  const [measure, setMeasure] = useState<((t: string, size: number) => number) | null>(null)
  useEffect(() => {
    getHelveticaMeasurer()
      .then((m) => setMeasure(() => m))
      .catch(() => {})
  }, [])

  const lines = buildStampLines(appearance, new Date(), measure ?? undefined)
  const qrSize = stampQrSize(lines)

  return (
    <div
      className="flex items-center text-left"
      style={{
        width: STAMP_WIDTH * scale,
        height: STAMP_HEIGHT * scale,
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
          style={{ width: qrSize * scale, height: qrSize * scale }}
        />
      )}
      <div className="flex min-w-0 flex-col justify-center" style={{ gap: STAMP_LEAD * scale }}>
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
  )
}
