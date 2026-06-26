// Campos del certificado según el esquema nacional ecuatoriano. Todas las AC
// acreditadas (Security Data 37746, FirmaSegura 61305, BCE, Uanataca, etc.) usan
// la MISMA estructura de subcampos `.3.N`; solo cambia el PEN del arco privado
// (1.3.6.1.4.1.<PEN>). Por eso detectamos el arco dinámicamente por el sufijo.

export const EC_FIELD = {
  cedula: 1,
  nombres: 2,
  apellido1: 3,
  apellido2: 4,
  cargo: 5,
  direccion: 7,
  telefono: 8,
  ciudad: 9,
  razonSocial: 10,
  ruc: 11,
  pais: 12,
} as const

const EC_OID_RE = /^1\.3\.6\.1\.4\.1\.\d+\.3\.(\d+)$/

/** Si el OID es un campo del esquema ecuatoriano, devuelve su número de subcampo. */
export function ecFieldNumber(oid: string): number | null {
  const m = EC_OID_RE.exec(oid)
  return m ? Number(m[1]) : null
}

export interface EcFields {
  cedula?: string
  cargo?: string
  /** Razón social de la empresa (solo en certificados de representante / jurídica). */
  companyName?: string
  /** RUC: de la empresa (jurídica) o personal (natural con RUC). */
  ruc?: string
}

export type PersonType = 'natural' | 'natural_ruc' | 'juridica'

export interface PersonClassification {
  type: PersonType
  label: string
}

/**
 * Clasifica el tipo de firmante a partir de los campos del certificado:
 * - Persona Jurídica: representa a una empresa (hay razón social).
 * - Persona Natural con RUC: persona con RUC propio, sin empresa.
 * - Persona Natural: solo cédula.
 */
export function classifyPerson(f: EcFields): PersonClassification {
  if (f.companyName) return { type: 'juridica', label: 'Persona Jurídica' }
  if (f.ruc) return { type: 'natural_ruc', label: 'Persona Natural con RUC' }
  return { type: 'natural', label: 'Persona Natural' }
}
