import { useCallback, useEffect, useState } from 'react'
import {
  deleteCertificate,
  importP12,
  listCertificates,
  unlockVault,
  type CertSummary,
  type ImportOptions,
  type UnlockedVault,
} from './vault'

export interface VaultState {
  loading: boolean
  /** Certificados guardados (resumen visible sin desbloquear). */
  certificates: CertSummary[]
  /** Certificado desbloqueado en la sesión actual (solo memoria). */
  unlocked: UnlockedVault | null
  /** Id del certificado activo/desbloqueado. */
  activeId: string | null
}

export function useVault() {
  const [state, setState] = useState<VaultState>({
    loading: true,
    certificates: [],
    unlocked: null,
    activeId: null,
  })

  const refresh = useCallback(async () => {
    const certificates = await listCertificates()
    setState((s) => ({ ...s, loading: false, certificates }))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const importCertificate = useCallback(async (p12Bytes: Uint8Array, opts: ImportOptions) => {
    const { id, unlocked } = await importP12(p12Bytes, opts)
    const certificates = await listCertificates()
    setState((s) => ({ ...s, certificates, unlocked, activeId: id }))
    return unlocked
  }, [])

  const unlock = useCallback(async (id: string, pin?: string) => {
    const { id: finalId, unlocked } = await unlockVault(id, pin)
    const certificates = await listCertificates()
    setState((s) => ({ ...s, certificates, unlocked, activeId: finalId }))
    return unlocked
  }, [])

  const lock = useCallback(() => {
    setState((s) => ({ ...s, unlocked: null, activeId: null }))
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteCertificate(id)
    const certificates = await listCertificates()
    setState((s) => ({
      ...s,
      certificates,
      unlocked: s.activeId === id ? null : s.unlocked,
      activeId: s.activeId === id ? null : s.activeId,
    }))
  }, [])

  return {
    ...state,
    hasCertificate: state.certificates.length > 0,
    refresh,
    importCertificate,
    unlock,
    lock,
    deleteCertificate: remove,
  }
}
