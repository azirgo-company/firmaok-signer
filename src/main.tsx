import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'
import { applyTheme, getInitialTheme } from './lib/useTheme'

// Aplica el tema antes del primer render para minimizar el parpadeo. La CSP
// (script-src 'self') impide un script inline en index.html, así que se hace aquí.
applyTheme(getInitialTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
