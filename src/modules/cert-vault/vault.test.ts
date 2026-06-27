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
  hasMasterPassword,
  wipeAll,
  DuplicateCertError,
  type ImportOptions,
} from './vault'

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

// Argon2id rápido para tests (la app usa los params seguros por defecto).
const FAST: ArgonParams = { memorySize: 8192, iterations: 1, parallelism: 1 }
const MASTER = 'contraseña-maestra-larga'
const opts = (master = MASTER): ImportOptions => ({ certPassword: 'x', masterPassword: master, argonParams: FAST })

describe('vault con contraseña maestra única (Argon2id)', () => {
  beforeEach(async () => {
    await wipeAll()
  })

  it('crea la maestra al primer import, lista y desbloquea por id', async () => {
    expect(await hasMasterPassword()).toBe(false)
    const a = makeP12('ANA TORRES', '0102030405')
    const { id, unlocked } = await importP12(a, opts())
    expect(unlocked.subject.commonName).toBe('ANA TORRES')
    expect(await hasMasterPassword()).toBe(true)

    const list = await listCertificates()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('ANA TORRES')

    const re = await unlockVault(id, MASTER)
    expect(re.unlocked.subject.commonName).toBe('ANA TORRES')
    expect(re.unlocked.signingKey.extractable).toBe(false)
  })

  it('rechaza reimportar el mismo certificado (dedup por huella)', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    await importP12(a, opts())
    await expect(importP12(a, opts())).rejects.toThrow(DuplicateCertError)
  })

  it('varios certificados con la misma maestra; borrado individual', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    const b = makeP12('LUIS PEREZ', '0908070605')
    const ra = await importP12(a, opts())
    await importP12(b, opts())

    let list = await listCertificates()
    expect(list.map((c) => c.label).sort()).toEqual(['ANA TORRES', 'LUIS PEREZ'])

    await deleteCertificate(ra.id)
    list = await listCertificates()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('LUIS PEREZ')
  })

  it('rechaza maestra incorrecta al desbloquear y al añadir otro', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    const { id } = await importP12(a, opts())
    await expect(unlockVault(id, 'otra-clave-larga-distinta')).rejects.toThrow(/incorrecta/i)
    const b = makeP12('OTRO', '111')
    await expect(importP12(b, opts('otra-clave-larga-distinta'))).rejects.toThrow(/incorrecta/i)
  })

  it('exige al menos 12 caracteres al crear la maestra', async () => {
    const a = makeP12('ANA TORRES', '0102030405')
    await expect(importP12(a, opts('corta'))).rejects.toThrow(/12/)
  })
})
