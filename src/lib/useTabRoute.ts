import { useEffect, useState } from 'react'

// Enrutado mínimo por path (sin dependencias): cada tab tiene su propia URL
// (/firmar, /validar, /certificado) para que al recargar se mantenga el tab.
// El fallback SPA (nginx try_files + navigateFallback del service worker) sirve
// index.html en cualquiera de estas rutas, también offline.
export const TAB_IDS = ['firmar', 'validar', 'certificado'] as const
export type Tab = (typeof TAB_IDS)[number]

const DEFAULT_TAB: Tab = 'firmar'

function tabFromPath(pathname: string): Tab | null {
  const seg = pathname.replace(/^\/+/, '').split('/')[0]
  return (TAB_IDS as readonly string[]).includes(seg) ? (seg as Tab) : null
}

export function useTabRoute(): [Tab, (tab: Tab) => void] {
  const [tab, setTabState] = useState<Tab>(
    () => tabFromPath(window.location.pathname) ?? DEFAULT_TAB,
  )

  // Canonicaliza la URL inicial ("/" o una ruta desconocida -> "/firmar")
  // sin dejar una entrada extra en el historial.
  useEffect(() => {
    if (tabFromPath(window.location.pathname) === null) {
      window.history.replaceState(null, '', `/${DEFAULT_TAB}`)
    }
  }, [])

  // Botones atrás/adelante del navegador.
  useEffect(() => {
    const onPop = () =>
      setTabState(tabFromPath(window.location.pathname) ?? DEFAULT_TAB)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const setTab = (next: Tab) => {
    if (next !== tabFromPath(window.location.pathname)) {
      window.history.pushState(null, '', `/${next}`)
    }
    setTabState(next)
  }

  return [tab, setTab]
}
