import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { toArrayBuffer } from '../../lib/bytes'
import { ensureCryptoEngine } from './engine'

// OIDs CMS / PAdES
const OID_DATA = '1.2.840.113549.1.7.1'
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_SIGNING_CERT_V2 = '1.2.840.113549.1.9.16.2.47'

export interface PadesCmsInput {
  /** Clave de firma NO extraíble (WebCrypto), RSASSA-PKCS1-v1_5 / SHA-256. */
  signingKey: CryptoKey
  /** Certificado del firmante (hoja) en DER. */
  leafCertDer: Uint8Array
  /** Cadena completa (hoja + intermedias) en DER que se embebe en el CMS. */
  chainDer: Uint8Array[]
  /** Bytes del documento (rango /ByteRange) que se firman de forma "detached". */
  contentBytes: Uint8Array
  /** Hora declarada de firma. Por defecto, ahora. */
  signingTime?: Date
}

/**
 * Construye una firma CMS SignedData "detached" conforme a PAdES-B (perfil B-B):
 * atributos firmados content-type, message-digest, signing-time y signing-certificate-v2
 * (ESS). Devuelve el DER del ContentInfo, listo para embeber en /Contents del PDF.
 */
export async function buildPadesCms(input: PadesCmsInput): Promise<Uint8Array> {
  ensureCryptoEngine()

  const certificates = input.chainDer.map((der) =>
    pkijs.Certificate.fromBER(toArrayBuffer(der)),
  )
  const signerCert = pkijs.Certificate.fromBER(toArrayBuffer(input.leafCertDer))

  const messageDigest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBuffer(input.contentBytes)),
  )
  const certHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBuffer(input.leafCertDer)),
  )

  const signedAttrs = [
    new pkijs.Attribute({
      type: OID_CONTENT_TYPE,
      values: [new asn1js.ObjectIdentifier({ value: OID_DATA })],
    }),
    new pkijs.Attribute({
      type: OID_SIGNING_TIME,
      values: [new asn1js.UTCTime({ valueDate: input.signingTime ?? nowUtc() })],
    }),
    new pkijs.Attribute({
      type: OID_MESSAGE_DIGEST,
      values: [new asn1js.OctetString({ valueHex: toArrayBuffer(messageDigest) })],
    }),
    new pkijs.Attribute({
      type: OID_SIGNING_CERT_V2,
      values: [buildSigningCertificateV2(certHash)],
    }),
  ]

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: signerCert.issuer,
      serialNumber: signerCert.serialNumber,
    }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: signedAttrs }),
  })

  const signedData = new pkijs.SignedData({
    version: 1,
    // Detached: declaramos el tipo de contenido pero NO embebemos el documento.
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID_DATA }),
    signerInfos: [signerInfo],
    certificates,
  })

  await signedData.sign(input.signingKey, 0, 'SHA-256')

  const contentInfo = new pkijs.ContentInfo({
    contentType: OID_SIGNED_DATA,
    content: signedData.toSchema(true),
  })
  return new Uint8Array(contentInfo.toSchema().toBER(false))
}

/**
 * SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
 * ESSCertIDv2 ::= SEQUENCE { hashAlgorithm [DEFAULT sha256], certHash OCTET STRING, ... }
 * Como el hash es SHA-256 (default), omitimos hashAlgorithm.
 */
function buildSigningCertificateV2(certHash: Uint8Array): asn1js.Sequence {
  const essCertIdV2 = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: toArrayBuffer(certHash) })],
  })
  return new asn1js.Sequence({
    value: [new asn1js.Sequence({ value: [essCertIdV2] })],
  })
}

function nowUtc(): Date {
  return new Date()
}
