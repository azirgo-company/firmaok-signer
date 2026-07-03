import { Download, Plus, Share } from "lucide-react"
import { useState } from "react"
import { useInstallPrompt } from "../modules/pwa/useInstallPrompt"
import { Modal } from "./ui"

/** Botón "Instalar app" que aparece solo si la PWA no está instalada. */
export function InstallButton() {
  const { canInstall, isStandalone, isIOS, promptInstall } = useInstallPrompt()
  const [showIos, setShowIos] = useState(false)

  // Ya instalada / corriendo como app: no mostrar nada.
  if (isStandalone) return null
  // Sin prompt nativo y no es iOS: el navegador no ofrece instalación.
  if (!canInstall && !isIOS) return null

  return (
    <>
      <button
        type="button"
        onClick={() => (canInstall ? promptInstall() : setShowIos(true))}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-500/20 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-100"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2} />
        Descargar
      </button>

      {showIos && (
        <Modal
          title="Instalar en iPhone / iPad"
          onClose={() => setShowIos(false)}
        >
          <ol className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                1
              </span>
              <span className="inline-flex items-center gap-1">
                Toca{" "}
                <Share className="h-4 w-4 text-brand-500" strokeWidth={2} />{" "}
                Compartir en la barra de Safari.
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                2
              </span>
              <span className="inline-flex items-center gap-1">
                Elige{" "}
                <Plus className="h-4 w-4 text-brand-500" strokeWidth={2} />{" "}
                «Añadir a pantalla de inicio».
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">
                3
              </span>
              <span>
                Confirma «Añadir». La app quedará en tu pantalla de inicio.
              </span>
            </li>
          </ol>
        </Modal>
      )}
    </>
  )
}
