import { useCallback, useEffect, useState } from 'react'
import {
  getStoredMethod,
  hasStoredCertificate,
  importP12,
  unlockVault,
  wipeVault,
  type ImportOptions,
  type UnlockedVault,
} from './vault'
import type { ProtectionMethod } from './key-protection'

export interface VaultState {
  loading: boolean
  hasCertificate: boolean
  method: ProtectionMethod | null
  /** Certificado desbloqueado en la sesión actual (solo memoria). */
  unlocked: UnlockedVault | null
}

export function useVault() {
  const [state, setState] = useState<VaultState>({
    loading: true,
    hasCertificate: false,
    method: null,
    unlocked: null,
  })

  const refresh = useCallback(async () => {
    const [hasCertificate, method] = await Promise.all([hasStoredCertificate(), getStoredMethod()])
    setState((s) => ({ ...s, loading: false, hasCertificate, method }))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const importCertificate = useCallback(
    async (p12Bytes: Uint8Array, opts: ImportOptions) => {
      const unlocked = await importP12(p12Bytes, opts)
      setState((s) => ({
        ...s,
        hasCertificate: true,
        method: opts.method,
        unlocked,
      }))
      return unlocked
    },
    [],
  )

  const unlock = useCallback(async (pin?: string) => {
    const unlocked = await unlockVault(pin)
    setState((s) => ({ ...s, unlocked }))
    return unlocked
  }, [])

  const lock = useCallback(() => {
    setState((s) => ({ ...s, unlocked: null }))
  }, [])

  const wipe = useCallback(async () => {
    await wipeVault()
    setState((s) => ({ ...s, hasCertificate: false, method: null, unlocked: null }))
  }, [])

  return { ...state, refresh, importCertificate, unlock, lock, wipe }
}
