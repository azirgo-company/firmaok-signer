import { useCallback, useEffect, useState } from 'react'

// Tema claro/oscuro con override manual. Tailwind v4 está configurado (en index.css)
// para que el variant `dark:` responda a la clase `.dark` en <html>, no al media
// query del sistema. Así el usuario puede forzar un tema desde el header.
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'firmaok-theme'

/** Tema inicial: la preferencia guardada o, si no hay, la del sistema. */
export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Aplica el tema al <html>: clase `.dark` (Tailwind) + `color-scheme` nativo. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggle]
}
