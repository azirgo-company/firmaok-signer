import { ArrowRight, Lock, Moon, ShieldCheck, Sun, Trash2, WifiOff } from "lucide-react"
import { Button } from "../../components/ui"
import type { Theme } from "../../lib/useTheme"

interface Props {
  onAccept: () => void
  theme: Theme
  onToggleTheme: () => void
}

const POINTS = [
  {
    icon: WifiOff,
    title: "Todo en tu dispositivo",
    body: "El certificado (.p12), su clave privada y tus documentos nunca salen de aquí. No hay servidor.",
  },
  {
    icon: Lock,
    title: "Cifrado en reposo",
    body: "La clave se guarda con AES-256-GCM, protegida por tu contraseña maestra (Argon2id). Se importa como no extraíble.",
  },
  {
    icon: ShieldCheck,
    title: "Sin rastreo (LOPDA)",
    body: "Cero analítica y cero terceros. Procesamiento 100% local conforme a la Ley de Protección de Datos.",
  },
  {
    icon: Trash2,
    title: "Derecho de supresión",
    body: "Borra el certificado y sus datos cuando quieras desde Firmar › Administrar certificados.",
  },
]

/** Pantalla de consentimiento informado y aviso de privacidad (LOPDA). */
export function ConsentScreen({ onAccept, theme, onToggleTheme }: Props) {
  return (
    <div className="relative grid min-h-[100dvh] place-items-center px-4 py-10">
      <button
        onClick={onToggleTheme}
        aria-label={
          theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
        }
        title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {theme === "dark" ? (
          <Sun className="h-5 w-5" strokeWidth={2} />
        ) : (
          <Moon className="h-5 w-5" strokeWidth={2} />
        )}
      </button>

      <div className="w-full max-w-xl">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Logo a color para fondo claro; versión blanca para tema oscuro.
              El swap es puro CSS según la clase .dark de <html>. */}
          <img
            src="/logo-firmaok-light.webp"
            alt="FirmaOK"
            className="mb-4 h-11 w-auto dark:hidden"
          />
          <img
            src="/firma-ok-header.png"
            alt="FirmaOK"
            className="mb-4 hidden h-12 w-auto dark:block"
          />
          <p className="text-[15px] text-slate-500">
            Firma y valida PDF — 100% en tu dispositivo
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {POINTS.map((p) => {
            const Icon = p.icon
            return (
              <div
                key={p.title}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <Icon
                  className="mb-2.5 h-5 w-5 text-brand-500"
                  strokeWidth={2}
                />
                <p className="text-sm font-semibold tracking-tight">
                  {p.title}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  {p.body}
                </p>
              </div>
            )
          })}
        </div>

        <p className="mt-5 text-center text-xs text-slate-400">
          Modo offline estricto: firmas PAdES-B válidas y verificables en
          validadores oficiales.
        </p>

        <Button onClick={onAccept} className="mt-6 w-full py-3 text-[15px]">
          Entiendo y acepto
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}
