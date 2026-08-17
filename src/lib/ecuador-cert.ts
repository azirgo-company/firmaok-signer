// Campos del certificado según el esquema nacional ecuatoriano. Todas las AC
// acreditadas (Security Data 37746, FirmaSegura 61305, BCE 37947, Uanataca 47286,
// ANF 37442, CorpNewBest 34380, Lazzate 59382, etc.) usan la MISMA estructura de
// subcampos `.3.N`; solo cambia el PEN del arco privado (1.3.6.1.4.1.<PEN>). Por eso
// detectamos el arco dinámicamente por el sufijo en vez de mantener un catálogo por AC.
//
// Sobre ese motor genérico hay tres capas de respaldo, porque no todas las AC ponen
// todo en extensiones:
//   1. Arco con sufijo intermedio: UANATACA usa 47286.102.3.N (no 47286.3.N).
//   2. Subject DN: AppFirmas no usa extensiones propias; el RUC va en
//      organizationIdentifier ("TINEC-<ruc>") y la cédula en serialNumber ("IDCEC-<cédula>").
//   3. Validación de forma: el .3.11 de algunas AC llega binario (no legible) o con
//      un valor que no es un RUC (el OID legacy de ANF trae su nº de arco, "37442").
//      Solo aceptamos candidatos con forma de RUC (13 dígitos) o cédula (10 dígitos).

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

/** OIDs del Subject DN que usamos como respaldo cuando no hay extensiones. */
export const DN_OID = {
  cn: '2.5.4.3',
  surname: '2.5.4.4',
  serialNumber: '2.5.4.5',
  locality: '2.5.4.7',
  organization: '2.5.4.10',
  givenName: '2.5.4.42',
  organizationIdentifier: '2.5.4.97',
} as const

// El sufijo intermedio `(?:\.\d+)*` es opcional: cubre 37746.3.N y también 47286.102.3.N.
// El cuantificador es voraz, así que ante varios ".3." se toma el último (el subcampo real).
const EC_OID_RE = /^1\.3\.6\.1\.4\.1\.\d+(?:\.\d+)*\.3\.(\d+)$/

/**
 * OID legacy de ANF. NO es confiable: en la variante ANF High Assurance trae el número
 * de arco OID de ANF ("37442") en vez de un RUC, por eso solo se acepta si tiene forma
 * de RUC y se consulta después de los candidatos buenos.
 */
const LEGACY_RUC_OID = '1.3.6.1.4.1.18332.19.2'

const RUC_RE = /^\d{13}$/
const CEDULA_RE = /^\d{10}$/
/** Identificadores con prefijo de esquema: "TINEC-0993372015001", "IDCEC-0912345678". */
const PREFIXED_ID_RE = /^[A-Z]{2,8}[-:]\s*(\d{9,13})$/i

/** Si el OID es un campo del esquema ecuatoriano, devuelve su número de subcampo. */
export function ecFieldNumber(oid: string): number | null {
  const m = EC_OID_RE.exec(oid)
  return m ? Number(m[1]) : null
}

/** Extensiones que vale la pena decodificar (evita parsear keyUsage, CRLs, etc.). */
export function isEcCertOid(oid: string): boolean {
  return oid === LEGACY_RUC_OID || EC_OID_RE.test(oid)
}

/** Datos crudos de un certificado, independientes de la librería que lo parseó. */
export interface CertRawData {
  /** Extensiones relevantes con su valor ya decodificado a texto (undefined si no es legible). */
  extensions: Array<{ oid: string; value?: string }>
  /** Atributos del Subject DN, indexados por la clave de `DN_OID`. */
  dn: Partial<Record<keyof typeof DN_OID, string>>
}

export interface EcFields {
  cedula?: string
  cargo?: string
  /** Razón social de la empresa (solo en certificados de representante / jurídica). */
  companyName?: string
  /** RUC: de la empresa (jurídica) o personal (natural con RUC). */
  ruc?: string
  /** El RUC se compuso como cédula + "001"; no venía acreditado en el certificado. */
  rucDerived?: boolean
  /** Nombre completo compuesto (apellidos + nombres); respaldo cuando el CN falta. */
  fullName?: string
  /** Dirección/localidad del firmante. */
  address?: string
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
 *
 * Un RUC compuesto a partir de la cédula (+"001") NO cuenta como "natural con RUC":
 * es un valor calculado por nosotros, no un dato que acredite la AC.
 */
export function classifyPerson(f: EcFields): PersonClassification {
  if (f.companyName) return { type: 'juridica', label: 'Persona Jurídica' }
  if (f.ruc && !f.rucDerived) return { type: 'natural_ruc', label: 'Persona Natural con RUC' }
  return { type: 'natural', label: 'Persona Natural' }
}

/**
 * Resuelve los datos del firmante combinando extensiones del esquema EC y Subject DN,
 * validando la forma de cada identificador. Sirve para cualquier AC acreditada.
 */
export function extractEcFields(raw: CertRawData): EcFields {
  const ec: Record<number, string> = {}
  let legacyRuc: string | undefined
  for (const { oid, value } of raw.extensions) {
    const text = legibleText(value)
    if (!text) continue
    if (oid === LEGACY_RUC_OID) {
      legacyRuc ??= text
      continue
    }
    const n = ecFieldNumber(oid)
    // Nos quedamos con la primera aparición: el orden de las extensiones es el del DER.
    if (n !== null && ec[n] === undefined) ec[n] = text
  }
  const { dn } = raw

  // organizationIdentifier también entra como candidato a cédula: AppFirmas puede traer
  // ahí "TINEC-<10 dígitos>" (la cédula) en vez del RUC de 13.
  // Si nada tiene forma de cédula caemos al .3.1 crudo: los certificados de extranjeros
  // llevan ahí el pasaporte, que hay que mostrar aunque no sirva para componer el RUC.
  const cedula =
    pickCedula([ec[EC_FIELD.cedula], dn.serialNumber, dn.organizationIdentifier]) ??
    ec[EC_FIELD.cedula]
  const ruc = pickRuc([ec[EC_FIELD.ruc], dn.organizationIdentifier, legacyRuc], cedula)

  return {
    cedula,
    cargo: ec[EC_FIELD.cargo],
    companyName: ec[EC_FIELD.razonSocial],
    ruc: ruc?.value,
    rucDerived: ruc?.derived || undefined,
    fullName: composeFullName(ec, dn),
    address: composeAddress(ec, dn),
  }
}

/**
 * El .3.11 de UANATACA y CorpNewBest puede venir en binario en vez de texto. Descartamos
 * cualquier valor con bytes de control o con el carácter de reemplazo de UTF-8.
 */
function legibleText(value?: string): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if (!t) return undefined
  for (const ch of t) {
    const code = ch.codePointAt(0) as number
    if (code < 0x20 || code === 0x7f || code === 0xfffd) return undefined
  }
  return t
}

/** Extrae los dígitos de un identificador, aceptando prefijos tipo "TINEC-" / "IDCEC-". */
function idDigits(value?: string): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if (/^\d+$/.test(t)) return t
  return PREFIXED_ID_RE.exec(t)?.[1]
}

/**
 * Primer candidato con forma de RUC (13 dígitos). Descarta arcos OID y valores basura.
 * Si ninguno sirve, se compone con la cédula + "001": es lo que hacen todas las AC para
 * la persona natural, que no lleva el RUC en el certificado. Se marca como derivado
 * porque lo calculamos nosotros y no debe tratarse como un dato acreditado.
 */
function pickRuc(
  candidates: Array<string | undefined>,
  cedula?: string,
): { value: string; derived: boolean } | undefined {
  for (const c of candidates) {
    const digits = idDigits(c)
    if (digits && RUC_RE.test(digits)) return { value: digits, derived: false }
  }
  if (cedula && CEDULA_RE.test(cedula)) return { value: `${cedula}001`, derived: true }
  return undefined
}

/**
 * Primer candidato con forma de cédula (10 dígitos): la extensión .3.1, el serialNumber
 * del DN o el organizationIdentifier. Solo se acepta un valor que sea exactamente la
 * cédula (o venga con prefijo, "IDCEC-<cédula>"): hay AC que ponen en el serialNumber un
 * identificador compuesto ("0950194407-040425153037") que no debe recortarse.
 */
function pickCedula(candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    const digits = idDigits(c)
    if (digits && CEDULA_RE.test(digits)) return digits
  }
  return undefined
}

/** Apellidos + nombres, desde las extensiones .3.3/.3.4/.3.2 o desde SURNAME/GIVENNAME. */
function composeFullName(
  ec: Record<number, string>,
  dn: CertRawData['dn'],
): string | undefined {
  const fromExt = [ec[EC_FIELD.apellido1], ec[EC_FIELD.apellido2], ec[EC_FIELD.nombres]]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (fromExt) return fromExt
  const fromDn = [dn.surname, dn.givenName].filter(Boolean).join(' ').trim()
  return fromDn || undefined
}

function composeAddress(
  ec: Record<number, string>,
  dn: CertRawData['dn'],
): string | undefined {
  const parts = [ec[EC_FIELD.direccion], ec[EC_FIELD.ciudad] ?? dn.locality].filter(Boolean)
  return parts.join(', ') || undefined
}
