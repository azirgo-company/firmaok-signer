import { useCallback, useEffect, useState } from 'react'
import {
  deleteCertificate,
  hasMasterPassword,
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
  /** Ya existe una contraseña maestra configurada. */
  hasMaster: boolean
  /** Certificado desbloqueado en la sesión actual (solo memoria). */
  unlocked: UnlockedVault | null
  /** Id del certificado activo/desbloqueado. */
  activeId: string | null
}

export function useVault() {
  const [state, setState] = useState<VaultState>({
    loading: true,
    certificates: [],
    hasMaster: false,
    unlocked: null,
    activeId: null,
  })

  const refresh = useCallback(async () => {
    const [certificates, hasMaster] = await Promise.all([listCertificates(), hasMasterPassword()])
    setState((s) => ({ ...s, loading: false, certificates, hasMaster }))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const importCertificate = useCallback(async (p12Bytes: Uint8Array, opts: ImportOptions) => {
    const { id, unlocked } = await importP12(p12Bytes, opts)
    const [certificates, hasMaster] = await Promise.all([listCertificates(), hasMasterPassword()])
    setState((s) => ({ ...s, certificates, hasMaster, unlocked, activeId: id }))
    return unlocked
  }, [])

  const unlock = useCallback(async (id: string, masterPassword: string) => {
    const { id: finalId, unlocked } = await unlockVault(id, masterPassword)
    setState((s) => ({ ...s, unlocked, activeId: finalId }))
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
