// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { wrapText, buildStampLines, splitName, STAMP_NOTE_SIZE } from './appearance'

// Medidor determinista: 1 unidad por carácter (facilita comprobar la envoltura).
const byChars = (t: string) => t.length

describe('splitName', () => {
  it('separa 2 nombres y 2 apellidos en dos filas', () => {
    expect(splitName('PEDRO CLETO SEGURA OCHOA')).toEqual(['PEDRO CLETO', 'SEGURA OCHOA'])
  })

  it('con 3 palabras deja los 2 apellidos abajo', () => {
    expect(splitName('ANA TORRES VERA')).toEqual(['ANA', 'TORRES VERA'])
  })

  it('con 2 palabras o menos queda en una sola fila', () => {
    expect(splitName('ANA TORRES')).toEqual(['ANA TORRES'])
    expect(splitName('MADONNA')).toEqual(['MADONNA'])
  })

  it('ignora espacios repetidos y bordes', () => {
    expect(splitName('  PEDRO  CLETO   SEGURA  OCHOA ')).toEqual(['PEDRO CLETO', 'SEGURA OCHOA'])
  })
})

describe('wrapText', () => {
  it('envuelve por palabras respetando el ancho', () => {
    const lines = wrapText('hola mundo esto es una prueba', 11, byChars, 2)
    expect(lines.length).toBeLessThanOrEqual(2)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(11)
  })

  it('parte por caracteres una palabra sin espacios más larga que el ancho', () => {
    const lines = wrapText('aaaaaaaaaaaaaaaaaaaa', 8, byChars, 2) // 20 caracteres
    expect(lines[0]).toBe('aaaaaaaa') // primera línea llena (8)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('recorta con elipsis cuando excede el máximo de líneas', () => {
    const lines = wrapText('uno dos tres cuatro cinco seis siete ocho', 7, byChars, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(byChars(l)).toBeLessThanOrEqual(7)
  })

  it('deja el texto tal cual si cabe en una línea', () => {
    expect(wrapText('corto', 20, byChars, 2)).toEqual(['corto'])
  })
})

describe('buildStampLines · notas', () => {
  const base = { name: 'ANA TORRES', identification: '0102030405' }

  it('envuelve una nota larga a 2 líneas cuando hay measure', () => {
    const long = 'palabra '.repeat(40).trim()
    const lines = buildStampLines({ ...base, notes: long }, new Date('2026-01-01'), byChars)
    const notes = lines.filter((l) => l.size === STAMP_NOTE_SIZE)
    expect(notes).toHaveLength(2)
  })

  it('sin measure cae al modo simple (máx 2 líneas por saltos)', () => {
    const lines = buildStampLines(
      { ...base, notes: 'linea1\nlinea2\nlinea3' },
      new Date('2026-01-01'),
    )
    const texts = lines.map((l) => l.text)
    expect(texts).toContain('linea1')
    expect(texts).toContain('linea2')
    expect(texts).not.toContain('linea3')
  })

  it('no añade líneas de nota si está vacía o en blanco', () => {
    const lines = buildStampLines({ ...base, notes: '   ' }, new Date('2026-01-01'), byChars)
    expect(lines.some((l) => l.size === STAMP_NOTE_SIZE)).toBe(false)
  })

  it('no incluye la fecha por defecto y sí con includeDate', () => {
    const withoutDate = buildStampLines(base, new Date('2026-06-26T15:00:00'))
    expect(withoutDate.some((l) => /\d{2}\/\d{2}\/\d{4}/.test(l.text))).toBe(false)

    const withDate = buildStampLines({ ...base, includeDate: true }, new Date('2026-06-26T15:00:00'))
    expect(withDate.some((l) => /\d{2}\/\d{2}\/\d{4}/.test(l.text))).toBe(true)
  })
})
