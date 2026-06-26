import { useCallback, useState } from 'react'

const CONSENT_KEY = 'firmaok.lopda.consent.v1'

/** Gestiona el consentimiento informado (LOPDA). Se guarda solo localmente. */
export function useConsent() {
  const [accepted, setAccepted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'true'
    } catch {
      return false
    }
  })

  const accept = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_KEY, 'true')
    } catch {
      // almacenamiento no disponible: continuamos solo en memoria
    }
    setAccepted(true)
  }, [])

  return { accepted, accept }
}
