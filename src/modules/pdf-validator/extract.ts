import { bytesToBinaryString, concatBytes } from '../../lib/bytes'

export interface ExtractedSignature {
  byteRange: [number, number, number, number]
  /** Offset del "/ByteRange" en el PDF (para localizar el diccionario de firma). */
  byteRangeIndex: number
  /** DER del CMS (contenido de /Contents). */
  cmsDer: Uint8Array
  /** Bytes del documento cubiertos por la firma (rango a firmar/verificar). */
  signedContent: Uint8Array
}

const BYTE_RANGE_RE = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g

/**
 * Extrae todas las firmas de un PDF operando sobre Uint8Array (sin depender de Buffer).
 * Funciona igual en navegador y Node. Cada firma trae su CMS y los bytes cubiertos.
 */
export function extractSignatures(pdfBytes: Uint8Array): ExtractedSignature[] {
  // latin1: 1 char = 1 byte, así los índices del regex coinciden con offsets de bytes.
  const text = bytesToBinaryString(pdfBytes)
  const out: ExtractedSignature[] = []

  for (const m of text.matchAll(BYTE_RANGE_RE)) {
    const a = Number(m[1])
    const b = Number(m[2])
    const c = Number(m[3])
    const d = Number(m[4])
    if (![a, b, c, d].every(Number.isFinite)) continue

    const signedContent = concatBytes(
      pdfBytes.subarray(a, a + b),
      pdfBytes.subarray(c, c + d),
    )

    // El hueco /Contents está entre (a+b) y c, con forma <HEX....00>.
    const gap = text.slice(a + b, c)
    const open = gap.indexOf('<')
    const close = gap.lastIndexOf('>')
    if (open === -1 || close === -1 || close <= open) continue
    const hex = gap
      .slice(open + 1, close)
      .replace(/[^0-9a-fA-F]/g, '')
      .replace(/(?:00)+$/i, '') // quitamos el relleno de ceros

    const cmsDer = hexToBytes(hex)
    if (cmsDer.length === 0) continue

    out.push({ byteRange: [a, b, c, d], byteRangeIndex: m.index ?? 0, cmsDer, signedContent })
  }

  return out
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16)
  }
  return out
}
