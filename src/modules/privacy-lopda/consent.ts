import { useCallback, useState } from 'react'

// v2: se añadió la divulgación de Google Analytics; los usuarios que aceptaron
// v1 deben volver a ver el aviso actualizado (consentimiento informado LOPDP).
const CONSENT_KEY = 'firmaok.lopda.consent.v2'

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
