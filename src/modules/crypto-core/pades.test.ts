// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import forge from 'node-forge'
import * as pkijs from 'pkijs'
import { binaryStringToBytes, toArrayBuffer } from '../../lib/bytes'
import { buildPadesCms } from './pades'
import { ensureCryptoEngine } from './engine'

interface TestCert {
  signingKey: CryptoKey
  leafCertDer: Uint8Array
  chainDer: Uint8Array[]
}

async function makeSigner(): Promise<TestCert> {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0A'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  const attrs = [
    { name: 'commonName', value: 'ANA TORRES' },
    { type: '2.5.4.5', value: '1717171717' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const certDer = binaryStringToBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
  const pkcs8 = binaryStringToBytes(
    forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey))).getBytes(),
  )
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return { signingKey, leafCertDer: certDer, chainDer: [certDer] }
}

describe('buildPadesCms', () => {
  beforeAll(() => ensureCryptoEngine())

  it('produce un CMS SignedData detached que verifica criptográficamente', async () => {
    const signer = await makeSigner()
    const content = new TextEncoder().encode('contenido del ByteRange del PDF')

    const cmsDer = await buildPadesCms({
      signingKey: signer.signingKey,
      leafCertDer: signer.leafCertDer,
      chainDer: signer.chainDer,
      contentBytes: content,
      signingTime: new Date('2026-06-26T12:00:00Z'),
    })

    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cmsDer))
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })

    // Debe traer la cadena embebida y un signerInfo.
    expect(signedData.certificates?.length).toBe(1)
    expect(signedData.signerInfos.length).toBe(1)

    const result = await signedData.verify({
      signer: 0,
      data: toArrayBuffer(content),
      checkChain: false,
    })
    const ok = typeof result === 'boolean' ? result : (result as { signatureVerified: boolean }).signatureVerified
    expect(ok).toBe(true)
  })

  it('falla la verificación si el contenido fue alterado', async () => {
    const signer = await makeSigner()
    const content = new TextEncoder().encode('original')
    const cmsDer = await buildPadesCms({
      signingKey: signer.signingKey,
      leafCertDer: signer.leafCertDer,
      chainDer: signer.chainDer,
      contentBytes: content,
    })
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cmsDer))
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })

    const tampered = new TextEncoder().encode('ALTERADO')
    // PKI.js rechaza (lanza o devuelve false) cuando el message-digest no coincide.
    let ok: boolean
    try {
      const result = await signedData.verify({ signer: 0, data: toArrayBuffer(tampered), checkChain: false })
      ok = typeof result === 'boolean' ? result : (result as { signatureVerified: boolean }).signatureVerified
    } catch {
      ok = false
    }
    expect(ok).toBe(false)
  })
})
