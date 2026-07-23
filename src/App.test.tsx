import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'

// pdf.js referencia APIs de canvas del navegador (DOMMatrix) al importarse; en el
// smoke test del wiring lo sustituimos por un stub.
vi.mock('./modules/pdf-viewer/PdfSignCanvas', () => ({
  PdfSignCanvas: () => null,
}))
vi.mock('./modules/pdf-viewer/PdfThumbnail', () => ({
  PdfThumbnail: () => null,
}))

import App from './App'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('muestra la pantalla de consentimiento LOPDA al iniciar', () => {
    render(<App />)
    expect(screen.getByText('Privacidad (LOPDP)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entiendo y acepto/i })).toBeInTheDocument()
  })

  it('al aceptar el consentimiento muestra la navegación de la app', async () => {
    const { findByRole } = render(<App />)
    const accept = await findByRole('button', { name: /Entiendo y acepto/i })
    accept.click()
    expect(await findByRole('button', { name: 'Firmar' })).toBeInTheDocument()
    expect(await findByRole('button', { name: 'Validar' })).toBeInTheDocument()
  })
})
