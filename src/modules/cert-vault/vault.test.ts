// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import forge from 'node-forge'
import { binaryStringToBytes } from '../../lib/bytes'
import type { ArgonParams } from './key-protection'
import {
  importP12,
  listCertificates,
  unlockVault,
  deleteCertificate,
  wipeAll,
  DuplicateCertError,
  type ImportOptions,
} from './vault'

// Argon2id rápido para tests (la app usa los params seguros por defecto).
const FAST: ArgonParams = { memorySize: 8192, iterations: 1, parallelism: 1 }
const opts = (pin: string): ImportOptions => ({ password: 'x', method: 'pin', pin, argonParams: FAST })

function makeP12(name: string, id: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date('2024-01-01')
  cert.validity.notAfter = new Date('2030-06-15')
  const attrs = [
    { name: 'commonName', value: name },
    { type: '2.5.4.5', value: id },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'x', { algorithm: '3des' })
  return binaryStringToBytes(forge.asn1.toDer(asn1).getBytes())
}

const PIN = 'contraseña-larga-1'

describe('vault multi-certificado (Argon2id)', () => {
  beforeEach(async () => {
    await wipeAll()
  })

  it('importa, lista por nombre y desbloquea por id (Argon2id)', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    const { id, unlocked } = await importP12(a, opts(PIN))
    expect(unlocked.subject.commonName).toBe('ANA TORRES')

    const list = await listCertificates()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('ANA TORRES')
    expect(list[0].method).toBe('pin')

    const re = await unlockVault(id, PIN)
    expect(re.unlocked.subject.commonName).toBe('ANA TORRES')
    expect(re.unlocked.signingKey.extractable).toBe(false)
  })

  it('rechaza reimportar el mismo certificado (dedup por huella)', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    await importP12(a, opts(PIN))
    await expect(importP12(a, opts(PIN))).rejects.toThrow(DuplicateCertError)
  })

  it('soporta varios certificados y borrado individual', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    const b = makeP12('LUIS PEREZ', '0908070605')
    const ra = await importP12(a, opts(PIN))
    await importP12(b, opts(PIN))

    let list = await listCertificates()
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.label).sort()).toEqual(['ANA TORRES', 'LUIS PEREZ'])

    await deleteCertificate(ra.id)
    list = await listCertificates()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('LUIS PEREZ')
  })

  it('rechaza contraseña maestra incorrecta y la corta (<10)', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    const { id } = await importP12(a, opts(PIN))
    await expect(unlockVault(id, 'otra-clave-larga')).rejects.toThrow(/incorrecta/i)
    const b = makeP12('OTRO', '111')
    await expect(importP12(b, opts('corta'))).rejects.toThrow(/10/)
  })
})
