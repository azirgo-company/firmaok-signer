import * as pkijs from 'pkijs'
import { bytesToBinaryString, bytesToHex, toArrayBuffer } from '../../lib/bytes'
import { ensureCryptoEngine } from '../crypto-core/engine'
import { extractSignatures, type ExtractedSignature } from './extract'
import { parseSigDict, type SigDictFields } from './sigdict'
import { oidName } from './oids'

const OID_CN = '2.5.4.3'
const OID_SERIAL = '2.5.4.5'
const OID_ORG = '2.5.4.10'
const OID_OU = '2.5.4.11'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_SIGNATURE_TIMESTAMP = '1.2.840.113549.1.9.16.2.14'

export interface SignatureReport {
  index: number
  signerName: string
  identification?: string
  organization?: string
  organizationalUnit?: string
  issuer: string
  rootCa?: string
  signingTime?: Date
  certValidFrom?: Date
  certValidTo?: Date
  certExpired?: boolean
  /** Integridad criptográfica de los bytes cubiertos por la firma. */
  integrityValid: boolean
  /** Bytes añadidos después de esta firma (normal en multifirma / LTV). */
  appendedBytesAfter: number
  coveredBytes: number
  totalBytes: number
  /** Perfil PAdES detectado (B-B, B-T…). */
  padesProfile: string
  signatureAlgorithm: string
  hashAlgorithm: string
  certFingerprintSha256?: string
  reason?: string
  location?: string
  subFilter?: string
  trustNote: string
}

/**
 * Valida un PDF firmado y devuelve un reporte por cada firma real encontrada.
 * Offline: verifica integridad criptográfica y lee datos del firmante/diccionario.
 * No comprueba revocación (OCSP/CRL) ni ancla la cadena (requieren red / raíces).
 * Las coincidencias de /ByteRange que no parsean como CMS se descartan (falsos positivos).
 */
export async function validatePdf(pdfBytes: Uint8Array): Promise<SignatureReport[]> {
  ensureCryptoEngine()
  const text = bytesToBinaryString(pdfBytes)
  const signatures = extractSignatures(pdfBytes)
  const reports: SignatureReport[] = []

  for (const sig of signatures) {
    const dict = parseSigDict(text, sig.byteRangeIndex)
    const report = await analyzeSignature(sig, dict, pdfBytes.length)
    if (report) reports.push({ ...report, index: reports.length })
  }
  return reports
}

async function analyzeSignature(
  extracted: ExtractedSignature,
  dict: SigDictFields,
  pdfLength: number,
): Promise<SignatureReport | null> {
  // Si el /Contents no es un CMS parseable, no es una firma real: lo descartamos.
  let signedData: pkijs.SignedData
  try {
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(extracted.cmsDer))
    signedData = new pkijs.SignedData({ schema: contentInfo.content })
  } catch {
    return null
  }

  const signedEnd = extracted.byteRange[2] + extracted.byteRange[3]
  const report: SignatureReport = {
    index: 0,
    signerName: 'Desconocido',
    issuer: 'Desconocido',
    integrityValid: false,
    appendedBytesAfter: Math.max(0, pdfLength - signedEnd),
    coveredBytes: extracted.byteRange[1] + extracted.byteRange[3],
    totalBytes: pdfLength,
    padesProfile: detectPadesProfile(signedData, dict),
    signatureAlgorithm: oidName(signedData.signerInfos[0]?.signatureAlgorithm?.algorithmId),
    hashAlgorithm: oidName(signedData.signerInfos[0]?.digestAlgorithm?.algorithmId),
    reason: dict.reason,
    location: dict.location,
    subFilter: dict.subFilter,
    trustNote:
      'Modo offline: no se verifican la cadena de confianza, la revocación (OCSP/CRL) ni el sello de tiempo. Solo se comprueba su presencia.',
  }

  const certs = (signedData.certificates ?? []).filter(
    (c): c is pkijs.Certificate => c instanceof pkijs.Certificate,
  )
  const signerCert = findSignerCert(signedData, certs)
  if (signerCert) {
    // En certificados ecuatorianos el CN suele venir como "<cédula> NOMBRE APELLIDOS".
    // Separamos la identificación del nombre para mostrarlos por separado.
    const { name, idFromCn } = splitIdFromName(readName(signerCert.subject, OID_CN))
    report.signerName = name || 'Desconocido'
    report.identification = readName(signerCert.subject, OID_SERIAL) || idFromCn || undefined
    report.organization = readName(signerCert.subject, OID_ORG) || undefined
    report.organizationalUnit = readName(signerCert.subject, OID_OU) || undefined
    report.issuer = readName(signerCert.issuer, OID_CN) || 'Desconocido'
    report.certValidFrom = signerCert.notBefore.value
    report.certValidTo = signerCert.notAfter.value
    report.certExpired = signerCert.notAfter.value.getTime() < Date.now()
    report.certFingerprintSha256 = await certFingerprint(signerCert)
  }
  report.rootCa = findRootName(certs, signerCert)
  report.signingTime = readSigningTime(signedData) ?? dict.signingTimeM

  try {
    const result = await signedData.verify({
      signer: 0,
      data: toArrayBuffer(extracted.signedContent),
      checkChain: false,
    })
    report.integrityValid = readVerifyResult(result)
  } catch {
    report.integrityValid = false
  }

  return report
}

function detectPadesProfile(signedData: pkijs.SignedData, dict: SigDictFields): string {
  if (dict.subFilter === 'ETSI.RFC3161') return 'Sello de tiempo (DocTimeStamp)'
  return hasSignatureTimestamp(signedData) ? 'B-T (con sello de tiempo)' : 'B-B (básica)'
}

/**
 * B-T requiere un sello de tiempo de TSA embebido (id-aa-signatureTimeStampToken).
 * Confirmamos no solo que esté el OID, sino que su valor sea un TimeStampToken
 * real (ContentInfo SignedData RFC 3161), para no reportar B-T por error.
 * Nota: en modo offline NO verificamos criptográficamente el sello; solo su presencia.
 */
function hasSignatureTimestamp(signedData: pkijs.SignedData): boolean {
  const attrs = signedData.signerInfos[0]?.unsignedAttrs?.attributes ?? []
  const attr = attrs.find((a) => a.type === OID_SIGNATURE_TIMESTAMP)
  const value = attr?.values?.[0]
  if (!value) return false
  try {
    const ci = new pkijs.ContentInfo({ schema: value })
    return ci.contentType === '1.2.840.113549.1.7.2' // signedData (token RFC 3161)
  } catch {
    return false
  }
}

function findSignerCert(
  signedData: pkijs.SignedData,
  certs: pkijs.Certificate[],
): pkijs.Certificate | undefined {
  const sid = signedData.signerInfos[0]?.sid
  if (sid instanceof pkijs.IssuerAndSerialNumber) {
    const match = certs.find((c) => c.serialNumber.isEqual(sid.serialNumber))
    if (match) return match
  }
  return certs[0]
}

/** Busca el certificado raíz (autofirmado) embebido en la cadena. */
function findRootName(
  certs: pkijs.Certificate[],
  signer?: pkijs.Certificate,
): string | undefined {
  const root = certs.find((c) => readName(c.subject, OID_CN) === readName(c.issuer, OID_CN))
  if (root) return readName(root.subject, OID_CN)
  // Si no está la raíz, mostramos el emisor del cert superior conocido.
  return signer ? readName(signer.issuer, OID_CN) || undefined : undefined
}

async function certFingerprint(cert: pkijs.Certificate): Promise<string> {
  const der = cert.toSchema().toBER(false)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', der))
  return bytesToHex(hash).toUpperCase().replace(/(.{2})(?=.)/g, '$1:')
}

/** Separa una cédula/RUC inicial del nombre: "0950194407 JUAN PEREZ" -> {id, name}. */
function splitIdFromName(cn: string): { name: string; idFromCn?: string } {
  const m = /^(\d{8,13})[-\s]+(.+)$/.exec(cn.trim())
  if (m) return { idFromCn: m[1], name: m[2].trim() }
  return { name: cn.trim() }
}

function readName(rdn: pkijs.RelativeDistinguishedNames, oid: string): string {
  const tv = rdn.typesAndValues.find((t) => t.type === oid)
  return (tv?.value?.valueBlock?.value as string) ?? ''
}

function readSigningTime(signedData: pkijs.SignedData): Date | undefined {
  const attrs = signedData.signerInfos[0]?.signedAttrs?.attributes ?? []
  const attr = attrs.find((a) => a.type === OID_SIGNING_TIME)
  const value = attr?.values?.[0] as { toDate?: () => Date } | undefined
  try {
    return value?.toDate?.()
  } catch {
    return undefined
  }
}

function readVerifyResult(result: unknown): boolean {
  if (typeof result === 'boolean') return result
  return Boolean((result as { signatureVerified?: boolean })?.signatureVerified)
}
