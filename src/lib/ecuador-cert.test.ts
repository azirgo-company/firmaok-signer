import { describe, it, expect } from 'vitest'
import { classifyPerson, extractEcFields, isEcCertOid, type CertRawData } from './ecuador-cert'

/** Atajo para construir la entrada de `extractEcFields` en los casos de prueba. */
function raw(
  extensions: Array<[oid: string, value?: string]>,
  dn: CertRawData['dn'] = {},
): CertRawData {
  return { extensions: extensions.map(([oid, value]) => ({ oid, value })), dn }
}

describe('extractEcFields — una AC por caso', () => {
  it('Security Data (37746): razón social, RUC y cédula desde el arco .3.N', () => {
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.37746.3.10', 'AZIRGO SA'],
        ['1.3.6.1.4.1.37746.3.11', '0993372015001'],
        ['1.3.6.1.4.1.37746.3.1', '0912345678'],
        ['1.3.6.1.4.1.37746.3.7', 'AV. 9 DE OCTUBRE 100'],
        ['1.3.6.1.4.1.37746.3.9', 'GUAYAQUIL'],
      ]),
    )
    expect(f).toMatchObject({
      companyName: 'AZIRGO SA',
      ruc: '0993372015001',
      cedula: '0912345678',
      address: 'AV. 9 DE OCTUBRE 100, GUAYAQUIL',
    })
    expect(classifyPerson(f).type).toBe('juridica')
  })

  it('UANATACA (47286.102): el arco con sufijo intermedio también se reconoce', () => {
    expect(isEcCertOid('1.3.6.1.4.1.47286.102.3.11')).toBe(true)
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.47286.102.3.1', '0912345678'],
        ['1.3.6.1.4.1.47286.102.3.11', '0993372015001'],
      ]),
    )
    expect(f.cedula).toBe('0912345678')
    expect(f.ruc).toBe('0993372015001')
  })

  it('UANATACA persona natural: descarta el .3.11 binario en vez de mostrar basura', () => {
    // El .3.11 llega como bytes crudos (no imprimibles), no como texto.
    const binario = String.fromCharCode(0x30, 0x0b, 0x06, 0x01, 0x02)
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.47286.102.3.1', '0912345678'],
        ['1.3.6.1.4.1.47286.102.3.11', binario],
      ],
      { surname: 'MOSQUERA VIÑAN', givenName: 'JEFFERSON' },
      ),
    )
    expect(f.cedula).toBe('0912345678')
    expect(f.fullName).toBe('MOSQUERA VIÑAN JEFFERSON')
    // Sin RUC legible, se compone con la cédula + "001", pero marcado como derivado:
    // el firmante sigue siendo persona natural, no "natural con RUC".
    expect(f).toMatchObject({ ruc: '0912345678001', rucDerived: true })
    expect(classifyPerson(f).type).toBe('natural')
  })

  it('el RUC compuesto no asciende a "natural con RUC" ni pisa al acreditado', () => {
    const compuesto = extractEcFields(raw([['1.3.6.1.4.1.37746.3.1', '0912345678']]))
    expect(compuesto).toMatchObject({ ruc: '0912345678001', rucDerived: true })
    expect(classifyPerson(compuesto).type).toBe('natural')

    // Con RUC propio en el certificado gana ese, sin marca de derivado.
    const acreditado = extractEcFields(
      raw([
        ['1.3.6.1.4.1.37746.3.1', '0912345678'],
        ['1.3.6.1.4.1.37746.3.11', '0912345678001'],
      ]),
    )
    expect(acreditado.rucDerived).toBeUndefined()
    expect(classifyPerson(acreditado).type).toBe('natural_ruc')
  })

  it('BCE (37947): compone el nombre desde apellidos + nombres (.3.3/.3.4/.3.2)', () => {
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.37947.3.2', 'CARLOS ANDRES'],
        ['1.3.6.1.4.1.37947.3.3', 'RUIZ'],
        ['1.3.6.1.4.1.37947.3.4', 'MORA'],
        ['1.3.6.1.4.1.37947.3.11', '0993372015001'],
      ]),
    )
    expect(f.fullName).toBe('RUIZ MORA CARLOS ANDRES')
    expect(f.ruc).toBe('0993372015001')
  })

  it('ANFAC: ignora el OID legacy 18332.19.2 con el nº de arco y usa organizationIdentifier', () => {
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.37442.3.10', 'ANF CLIENTE SA'],
        ['1.3.6.1.4.1.18332.19.2', '37442'], // nº de arco de ANF, NO un RUC
      ],
      { organizationIdentifier: 'VATEC-0993372015001' },
      ),
    )
    expect(f.ruc).toBe('0993372015001')
    expect(f.companyName).toBe('ANF CLIENTE SA')
  })

  it('ANFAC: acepta el OID legacy solo cuando sí trae forma de RUC', () => {
    const f = extractEcFields(raw([['1.3.6.1.4.1.18332.19.2', '0993372015001']]))
    expect(f.ruc).toBe('0993372015001')
  })

  it('CorpNewBest (34380) y Lazzate (59382): RUC y dirección desde su propio PEN', () => {
    const corp = extractEcFields(
      raw([
        ['1.3.6.1.4.1.34380.3.11', '0993372015001'],
        ['1.3.6.1.4.1.34380.3.9', 'QUITO'],
      ]),
    )
    expect(corp).toMatchObject({ ruc: '0993372015001', address: 'QUITO' })

    const lazzate = extractEcFields(
      raw([
        ['1.3.6.1.4.1.59382.3.11', '1790012345001'],
        ['1.3.6.1.4.1.59382.3.9', 'CUENCA'],
      ]),
    )
    expect(lazzate).toMatchObject({ ruc: '1790012345001', address: 'CUENCA' })
  })

  it('Firmasegura (61305): razón social y RUC', () => {
    const f = extractEcFields(
      raw([
        ['1.3.6.1.4.1.61305.3.10', 'FIRMASEGURA CLIENTE'],
        ['1.3.6.1.4.1.61305.3.11', '0993372015001'],
        ['1.3.6.1.4.1.61305.3.1', '0912345678'],
      ]),
    )
    expect(f).toMatchObject({
      companyName: 'FIRMASEGURA CLIENTE',
      ruc: '0993372015001',
      cedula: '0912345678',
    })
  })

  it('AppFirmas: sin extensiones propias, todo sale del Subject DN con sus prefijos', () => {
    const f = extractEcFields(
      raw([], {
        cn: 'JEFFERSON MOSQUERA',
        surname: 'MOSQUERA',
        givenName: 'JEFFERSON',
        serialNumber: 'IDCEC-0912345678',
        organizationIdentifier: 'TINEC-0993372015001',
        locality: 'GUAYAQUIL',
      }),
    )
    expect(f).toMatchObject({
      cedula: '0912345678',
      ruc: '0993372015001',
      fullName: 'MOSQUERA JEFFERSON',
      address: 'GUAYAQUIL',
    })
    expect(classifyPerson(f).type).toBe('natural_ruc')
  })

  it('AppFirmas: si organizationIdentifier trae la cédula (10 dígitos), la usa como tal', () => {
    const f = extractEcFields(raw([], { organizationIdentifier: 'TINEC-0912345678' }))
    expect(f.cedula).toBe('0912345678')
    // No es un RUC acreditado: se compone, se marca y no reetiqueta a la persona.
    expect(f.ruc).toBe('0912345678001')
    expect(f.rucDerived).toBe(true)
    expect(classifyPerson(f).type).toBe('natural')
  })
})

describe('validación de forma de los identificadores', () => {
  it('descarta candidatos a RUC que no tienen 13 dígitos', () => {
    const f = extractEcFields(
      raw([['1.3.6.1.4.1.37746.3.11', 'NO APLICA']], { organizationIdentifier: 'TINEC-123' }),
    )
    expect(f.ruc).toBeUndefined()
  })

  it('conserva el .3.1 aunque no sea una cédula (pasaporte de extranjero), sin componer RUC', () => {
    const f = extractEcFields(raw([['1.3.6.1.4.1.37746.3.1', 'AB1234567']]))
    expect(f.cedula).toBe('AB1234567')
    expect(f.ruc).toBeUndefined()
  })

  it('no recorta un serialNumber compuesto (cédula + timestamp) como si fuera cédula', () => {
    const f = extractEcFields(raw([], { serialNumber: '0950194407-040425153037' }))
    expect(f.cedula).toBeUndefined()
  })

  it('no confunde otros OIDs privados con el esquema EC', () => {
    expect(isEcCertOid('2.5.29.15')).toBe(false)
    expect(isEcCertOid('1.3.6.1.4.1.37746.4.11')).toBe(false)
    expect(isEcCertOid('1.3.6.1.4.1.37746.3.11')).toBe(true)
  })
})
