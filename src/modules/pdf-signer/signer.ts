import { Signer } from '@signpdf/utils'
import { buildPadesCms } from '../crypto-core/pades'
import type { UnlockedVault } from '../cert-vault/vault'

/**
 * Firmante PAdES que delega el cálculo CMS en WebCrypto + PKI.js usando la clave
 * NO extraíble del vault. @signpdf le entrega los bytes del /ByteRange y espera el
 * DER del CMS como Buffer.
 */
export class WebCryptoPadesSigner extends Signer {
  private readonly vault: UnlockedVault

  constructor(vault: UnlockedVault) {
    super()
    this.vault = vault
  }

  async sign(pdfBuffer: Buffer, signingTime?: Date): Promise<Buffer> {
    const cms = await buildPadesCms({
      signingKey: this.vault.signingKey,
      leafCertDer: this.vault.leafCertDer,
      chainDer: this.vault.chainDer,
      contentBytes: new Uint8Array(pdfBuffer),
      signingTime,
    })
    return Buffer.from(cms)
  }
}
