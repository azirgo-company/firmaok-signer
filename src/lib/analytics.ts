// Eventos de Google Analytics. gtag se define en public/gtag-init.js (script
// clásico, queda en window). Si el script fue bloqueado (adblock/offline), la
// llamada se ignora en silencio: la app nunca depende de analytics.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

export type AnalyticsEvent = 'p12_guardado' | 'pdf_validado' | 'pdf_firmado'

export function trackEvent(
  name: AnalyticsEvent,
  params?: Record<string, string | number | boolean>,
) {
  window.gtag?.('event', name, params)
}
