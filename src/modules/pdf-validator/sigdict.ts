// Extrae los campos del diccionario de firma del PDF (/SubFilter, /Reason, /Name,
// /Location, /M, /ContactInfo) que NO están en el CMS sino en el dict de la firma.

export interface SigDictFields {
  subFilter?: string
  filter?: string
  name?: string
  reason?: string
  location?: string
  contactInfo?: string
  /** Fecha declarada en /M (formato PDF D:YYYYMMDDHHmmSS). */
  signingTimeM?: Date
}

/**
 * Dado el texto latin1 del PDF y la posición del /ByteRange, busca el diccionario
 * de firma que lo contiene y extrae sus campos legibles.
 */
export function parseSigDict(text: string, byteRangeIndex: number): SigDictFields {
  // Ventana del diccionario de firma: desde el "<<" anterior hasta el ">>" que lo cierra.
  // Los campos /Reason, /M, /Name, /Location suelen ir DESPUÉS de /Contents, así que la
  // ventana debe abarcar más allá del blob hexadecimal de /Contents.
  const dictStart = text.lastIndexOf('<<', byteRangeIndex)
  const start = dictStart === -1 ? Math.max(0, byteRangeIndex - 2000) : dictStart

  const contentsAt = text.indexOf('/Contents', byteRangeIndex)
  let end = -1
  if (contentsAt !== -1) {
    const hexOpen = text.indexOf('<', contentsAt)
    const hexClose = hexOpen === -1 ? -1 : text.indexOf('>', hexOpen)
    end = text.indexOf('>>', hexClose === -1 ? contentsAt : hexClose)
  }
  if (end === -1) end = Math.min(text.length, byteRangeIndex + 4000)
  const dict = text.slice(start, end)

  return {
    subFilter: matchName(dict, 'SubFilter'),
    filter: matchName(dict, 'Filter'),
    name: matchString(dict, 'Name'),
    reason: matchString(dict, 'Reason'),
    location: matchString(dict, 'Location'),
    contactInfo: matchString(dict, 'ContactInfo'),
    signingTimeM: matchDate(dict, 'M'),
  }
}

function matchName(dict: string, key: string): string | undefined {
  const m = new RegExp(`/${key}\\s*/([A-Za-z0-9._-]+)`).exec(dict)
  return m?.[1]
}

/** Lee un valor de cadena PDF: literal `(...)` o hexadecimal `<...>` (UTF-16BE). */
function matchString(dict: string, key: string): string | undefined {
  const re = new RegExp(`/${key}\\s*(\\(|<)`)
  const m = re.exec(dict)
  if (!m) return undefined
  const open = m.index + m[0].length - 1
  if (dict[open] === '(') {
    return decodeLiteral(readBalancedParens(dict, open))
  }
  const close = dict.indexOf('>', open)
  if (close === -1) return undefined
  return decodeHexString(dict.slice(open + 1, close))
}

function readBalancedParens(s: string, openIndex: number): string {
  let depth = 0
  let out = ''
  for (let i = openIndex; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\') {
      out += ch + (s[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '(') {
      depth++
      if (depth === 1) continue
    } else if (ch === ')') {
      depth--
      if (depth === 0) break
    }
    out += ch
  }
  return out
}

function decodeLiteral(raw: string): string {
  // Desescapamos las secuencias PDF más comunes.
  const unescaped = raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
  // PDFDocEncoding/UTF-16: si empieza con BOM, decodificar como UTF-16BE.
  if (unescaped.charCodeAt(0) === 0xfe && unescaped.charCodeAt(1) === 0xff) {
    return utf16beToString(unescaped.slice(2))
  }
  return unescaped
}

function decodeHexString(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes: number[] = []
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.substr(i, 2), 16))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return utf16beToString(String.fromCharCode(...bytes.slice(2)))
  }
  return String.fromCharCode(...bytes)
}

function utf16beToString(s: string): string {
  let out = ''
  for (let i = 0; i + 1 < s.length; i += 2) {
    out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1))
  }
  return out
}

function matchDate(dict: string, key: string): Date | undefined {
  // /M (D:20260626153000-05'00')
  const m = new RegExp(`/${key}\\s*\\(D:(\\d{4})(\\d{2})(\\d{2})(\\d{2})?(\\d{2})?(\\d{2})?`).exec(dict)
  if (!m) return undefined
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isNaN(date.getTime()) ? undefined : date
}
