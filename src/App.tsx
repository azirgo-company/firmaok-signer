import { useState } from 'react'
import { PenLine, ShieldCheck, IdCard, WifiOff } from 'lucide-react'
import { useVault } from './modules/cert-vault/useVault'
import { useConsent } from './modules/privacy-lopda/consent'
import { ConsentScreen } from './modules/privacy-lopda/ConsentScreen'
import { CertPage } from './pages/CertPage'
import { SignPage } from './pages/SignPage'
import { ValidatePage } from './pages/ValidatePage'

type Tab = 'firmar' | 'validar' | 'certificado'

const TABS: { id: Tab; label: string; icon: typeof PenLine }[] = [
  { id: 'firmar', label: 'Firmar', icon: PenLine },
  { id: 'validar', label: 'Validar', icon: ShieldCheck },
  { id: 'certificado', label: 'Certificado', icon: IdCard },
]

export default function App() {
  const { accepted, accept } = useConsent()
  const vault = useVault()
  const [tab, setTab] = useState<Tab>('firmar')

  if (!accepted) return <ConsentScreen onAccept={accept} />

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/80 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo-firmaok.webp"
              alt="FirmaOK"
              className="h-7 w-auto rounded-md bg-white"
            />
            <span className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 sm:inline-flex dark:bg-slate-800 dark:text-slate-400">
              <WifiOff className="h-3 w-3" strokeWidth={2} />
              100% offline
            </span>
          </div>

          <nav className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 dark:bg-slate-900">
            {TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  <span className="hidden sm:inline">{t.label}</span>
                  {t.id === 'certificado' && vault.unlocked && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" />
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {tab === 'firmar' && <SignPage vault={vault} onGoToCert={() => setTab('certificado')} />}
        {tab === 'validar' && <ValidatePage />}
        {tab === 'certificado' && <CertPage vault={vault} />}
      </main>

      <footer className="border-t border-slate-200/70 py-4 text-center text-xs text-slate-400 dark:border-slate-800/70">
        Tus datos nunca salen de este dispositivo · Firmas PAdES · LOPDA
      </footer>
    </div>
  )
}
