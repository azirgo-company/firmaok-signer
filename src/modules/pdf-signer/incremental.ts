// Guardado del PDF por ACTUALIZACIÓN INCREMENTAL (ISO 32000-1 §7.5.6).
//
// pdf-lib solo sabe reescribir el documento entero: al guardar, todos los objetos
// cambian de offset. Eso destruye las firmas previas, porque su /ByteRange apunta a
// posiciones absolutas del archivo original y su hash cubre esos bytes exactos.
//
// Para poder añadir una firma sin invalidar las anteriores, aquí dejamos los bytes
// originales INTACTOS y añadimos al final solo los objetos nuevos o modificados, con
// su propia sección xref encadenada a la anterior por /Prev.

import {
  PDFCrossRefSection,
  PDFCrossRefStream,
  type PDFDict,
  type PDFDocument,
  type PDFObject,
  PDFRef,
  PDFStream,
  PDFTrailer,
  PDFTrailerDict,
} from 'pdf-lib'
import { concatBytes } from '../../lib/bytes'

/** Estado capturado al cargar el documento, necesario para escribir la actualización. */
export interface IncrementalBase {
  /** Huella de cada objeto indirecto tal como se cargó, para detectar cambios. */
  snapshot: ReadonlyMap<PDFRef, string>
  /** Offset de la última sección xref del original (irá en /Prev). */
  prevXref: number
  /** La sección anterior es un xref-stream (no una tabla clásica). */
  useXrefStream: boolean
}

/** ¿El PDF ya contiene alguna firma? (busca el marcador /ByteRange sin decodificar todo). */
export function hasSignature(pdfBytes: Uint8Array): boolean {
  return indexOfAscii(pdfBytes, '/ByteRange', 0) !== -1
}

/**
 * Prepara el documento recién cargado para guardarse en incremental. Debe llamarse
 * ANTES de modificarlo: toma la huella de los objetos y, sobre todo, reserva los
 * números de objeto de la revisión anterior.
 *
 * Lo segundo es imprescindible: pdf-lib descarta al parsear los xref-streams y los
 * object streams del original, así que su `largestObjectNumber` queda por debajo del
 * real y los objetos nuevos reutilizarían esos números. En una reescritura completa da
 * igual, pero en incremental sobrescribiría objetos vivos de la revisión anterior.
 */
export function prepareIncremental(pdfDoc: PDFDocument, original: Uint8Array): IncrementalBase {
  const context = pdfDoc.context
  const snapshot = new Map<PDFRef, string>()
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    snapshot.set(ref, fingerprint(obj))
  }

  const prevXref = findLastXrefOffset(original)
  const useXrefStream = isXrefStream(original, prevXref)
  const prevSize = readPrevSize(original, prevXref, useXrefStream)
  context.largestObjectNumber = Math.max(context.largestObjectNumber, prevSize - 1)

  return { snapshot, prevXref, useXrefStream }
}

/**
 * Serializa el documento como actualización incremental sobre `original`: devuelve
 * `original` byte a byte seguido de los objetos nuevos/modificados, una nueva sección
 * xref y un tráiler con /Prev. Las firmas ya presentes siguen cubriendo exactamente
 * los mismos bytes, así que conservan su validez criptográfica.
 */
export async function saveIncremental(
  pdfDoc: PDFDocument,
  original: Uint8Array,
  state: IncrementalBase,
): Promise<Uint8Array> {
  // Materializa fuentes/imágenes pendientes (lo que hace pdf-lib antes de escribir).
  await pdfDoc.flush()

  const context = pdfDoc.context
  const { snapshot, prevXref, useXrefStream } = state

  const changed: [PDFRef, PDFObject][] = []
  for (const entry of context.enumerateIndirectObjects()) {
    const before = snapshot.get(entry[0])
    if (before === undefined || before !== fingerprint(entry[1])) changed.push(entry)
  }
  if (changed.length === 0) return original

  // El prefijo debe terminar en fin de línea para que el primer objeto añadido no
  // quede pegado al "%%EOF" anterior.
  const prefix = endsWithEol(original) ? original : concatBytes(original, NEWLINE)
  const baseOffset = prefix.length

  const trailerFields = {
    Size: context.largestObjectNumber + 1 + (useXrefStream ? 1 : 0),
    Root: context.trailerInfo.Root,
    Encrypt: context.trailerInfo.Encrypt,
    Info: context.trailerInfo.Info,
    ID: context.trailerInfo.ID,
    Prev: prevXref,
  }

  // Offsets de cada objeto añadido (absolutos en el archivo final).
  let size = 0
  const offsets: number[] = []
  for (const entry of changed) {
    offsets.push(baseOffset + size)
    size += indirectObjectSize(entry)
  }
  const xrefOffset = baseOffset + size

  const parts: Uint8Array[] = [prefix]
  for (const entry of changed) parts.push(serializeIndirectObject(entry))

  if (useXrefStream) {
    // El xref-stream es un objeto más: se lleva el siguiente número libre y su propia
    // entrada. Va al final, así que su offset no depende de su propio tamaño.
    const xrefRef = PDFRef.of(context.largestObjectNumber + 1)
    const xref = PDFCrossRefStream.of(context.obj(trailerFields) as PDFDict, [])
    changed.forEach(([ref], i) => xref.addUncompressedEntry(ref, offsets[i]))
    xref.addUncompressedEntry(xrefRef, xrefOffset)
    parts.push(serializeIndirectObject([xrefRef, xref]))
  } else {
    const xref = PDFCrossRefSection.createEmpty()
    changed.forEach(([ref], i) => xref.addEntry(ref, offsets[i]))
    parts.push(serialize(xref), NEWLINE)
    parts.push(serialize(PDFTrailerDict.of(context.obj(trailerFields) as PDFDict)), NEWLINE, NEWLINE)
  }

  parts.push(serialize(PDFTrailer.forLastCrossRefSectionOffset(xrefOffset)), NEWLINE)
  return concatBytes(...parts)
}

const NEWLINE = new Uint8Array([0x0a])

interface Serializable {
  sizeInBytes(): number
  copyBytesInto(buffer: Uint8Array, offset: number): number
}

function serialize(o: Serializable): Uint8Array {
  const buf = new Uint8Array(o.sizeInBytes())
  o.copyBytesInto(buf, 0)
  return buf
}

/**
 * Huella de un objeto. De los streams solo se mide el diccionario y el tamaño del
 * contenido: pdf-lib nunca reescribe el contenido de un stream existente (al dibujar
 * crea streams nuevos), y serializar megabytes de imágenes sería carísimo.
 */
function fingerprint(obj: PDFObject): string {
  if (obj instanceof PDFStream) {
    return `${latin1(serialize(obj.dict))}|${obj.getContentsSize()}`
  }
  return latin1(serialize(obj))
}

function latin1(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return s
}

/** Tamaño de "N G obj\n<objeto>\nendobj\n\n" (mismo cálculo que el writer de pdf-lib). */
function indirectObjectSize([ref, obj]: [PDFRef, PDFObject]): number {
  return ref.sizeInBytes() + 3 + obj.sizeInBytes() + 9
}

function serializeIndirectObject(entry: [PDFRef, PDFObject]): Uint8Array {
  const [ref, obj] = entry
  const buf = new Uint8Array(indirectObjectSize(entry))
  let offset = 0
  offset += writeAscii(buf, offset, `${ref.objectNumber} ${ref.generationNumber} obj\n`)
  offset += obj.copyBytesInto(buf, offset)
  writeAscii(buf, offset, '\nendobj\n\n')
  return buf
}

function writeAscii(buf: Uint8Array, offset: number, text: string): number {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i)
  return text.length
}

function endsWithEol(bytes: Uint8Array): boolean {
  const last = bytes[bytes.length - 1]
  return last === 0x0a || last === 0x0d
}

/** Offset de la última sección xref, leído del `startxref` final del documento. */
function findLastXrefOffset(pdfBytes: Uint8Array): number {
  // El startxref vive en la cola del archivo; 2 KB sobran incluso con basura detrás.
  const from = Math.max(0, pdfBytes.length - 2048)
  const tail = latin1(pdfBytes.subarray(from))
  const at = tail.lastIndexOf('startxref')
  const digits = at === -1 ? undefined : /^\s*(\d+)/.exec(tail.slice(at + 'startxref'.length))?.[1]
  const offset = Number(digits)
  if (!digits || !Number.isFinite(offset) || offset <= 0 || offset >= pdfBytes.length) {
    throw new Error(
      'El PDF no declara un startxref válido, así que no se puede añadir la firma sin ' +
        'reescribirlo (lo que invalidaría las firmas que ya tiene).',
    )
  }
  return offset
}

/**
 * ¿La sección xref anterior es un xref-stream (PDF 1.5+) o una tabla clásica?
 * La actualización debe usar el mismo tipo: un tráiler clásico con /Prev apuntando
 * a un xref-stream no está previsto por la norma y hay visores que lo rechazan.
 */
function isXrefStream(pdfBytes: Uint8Array, offset: number): boolean {
  let i = offset
  while (i < pdfBytes.length && isWhitespace(pdfBytes[i])) i++
  return indexOfAscii(pdfBytes, 'xref', i) !== i
}

/**
 * /Size de la última sección xref: uno más que el mayor número de objeto usado en el
 * documento (ISO 32000-1 §7.5.5). Es la referencia para no reutilizar números.
 */
function readPrevSize(pdfBytes: Uint8Array, offset: number, useXrefStream: boolean): number {
  // En un xref-stream el diccionario está en el propio offset; en una tabla clásica,
  // en el `trailer` que va detrás de todas las entradas.
  const dictAt = useXrefStream ? offset : indexOfAscii(pdfBytes, 'trailer', offset)
  if (dictAt === -1) return 0
  const window = latin1(pdfBytes.subarray(dictAt, Math.min(pdfBytes.length, dictAt + 2048)))
  return Number(/\/Size\s+(\d+)/.exec(window)?.[1] ?? 0)
}

function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x00 || b === 0x0c
}

function indexOfAscii(haystack: Uint8Array, needle: string, from: number): number {
  const first = needle.charCodeAt(0)
  const limit = haystack.length - needle.length
  outer: for (let i = Math.max(0, from); i <= limit; i++) {
    if (haystack[i] !== first) continue
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}
