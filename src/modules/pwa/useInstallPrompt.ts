import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Detecta si la PWA se puede instalar y expone la acción de instalar. */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : undefined
  const isStandalone =
    installed ||
    (typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true))
  const isIOS =
    !!nav && /iphone|ipad|ipod/i.test(nav.userAgent) && !('MSStream' in window)

  async function promptInstall(): Promise<void> {
    if (!deferred) return
    await deferred.prompt()
    setDeferred(null)
  }

  return {
    /** El navegador ofreció instalar (Chrome/Edge/Android). */
    canInstall: !!deferred,
    /** Ya está instalada o corriendo como app. */
    isStandalone: !!isStandalone,
    /** iOS Safari: no hay prompt nativo; se instala manualmente. */
    isIOS,
    promptInstall,
  }
}
