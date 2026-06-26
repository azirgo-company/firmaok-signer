import { Check } from 'lucide-react'

export type FlowStepId = 'certificado' | 'firmar' | 'validar'

interface Props {
  current: FlowStepId
  /** Paso 1 (importar certificado) completado. */
  certDone: boolean
  onNavigate: (id: FlowStepId) => void
}

const STEPS: { id: FlowStepId; n: number; label: string }[] = [
  { id: 'certificado', n: 1, label: 'Importar certificado' },
  { id: 'firmar', n: 2, label: 'Firmar PDF' },
  { id: 'validar', n: 3, label: 'Validar firmas' },
]

/** Indicador de los 3 pasos del flujo, navegable, con progreso. */
export function FlowSteps({ current, certDone, onNavigate }: Props) {
  return (
    <nav className="mx-auto flex max-w-2xl items-center justify-center gap-1 px-4 py-4 sm:gap-2">
      {STEPS.map((step, i) => {
        const done = step.id === 'certificado' && certDone
        const active = step.id === current
        return (
          <div key={step.id} className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => onNavigate(step.id)}
              className="group flex items-center gap-2"
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-200 text-slate-500 group-hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step.n}
              </span>
              <span
                className={`hidden text-sm transition-colors sm:inline ${
                  active
                    ? 'font-semibold text-slate-900 dark:text-white'
                    : 'text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'
                }`}
              >
                {step.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="h-px w-5 bg-slate-200 sm:w-8 dark:bg-slate-700" aria-hidden />
            )}
          </div>
        )
      })}
    </nav>
  )
}
