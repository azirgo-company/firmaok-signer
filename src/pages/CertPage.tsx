import { useState } from 'react'
import {
  Fingerprint,
  Lock,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Unlock,
  CheckCircle2,
  FileBadge,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Field, Input, Spinner } from '../components/ui'
import { readFileBytes } from '../lib/file'
import { formatDate } from '../lib/date'
import { isWebAuthnPrfSupported, type ProtectionMethod } from '../modules/cert-vault/key-protection'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

export function CertPage({ vault }: { vault: Vault }) {
  if (vault.loading)
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-slate-500">
        <Spinner className="h-6 w-6 text-brand-500" />
      </div>
    )
  return vault.hasCertificate ? <StoredCert vault={vault} /> : <ImportCert vault={vault} />
}

function ImportCert({ vault }: { vault: Vault }) {
  const prfSupported = isWebAuthnPrfSupported()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<ProtectionMethod>(prfSupported ? 'webauthn-prf' : 'pin')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await readFileBytes(file)
      await vault.importCertificate(bytes, {
        password: password || undefined,
        method,
        pin: method === 'pin' ? pin : undefined,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Importar certificado</h2>
        <p className="mt-1 text-sm text-slate-500">
          Súbelo una sola vez. Se guarda cifrado en este dispositivo; no se vuelve a pedir el archivo.
        </p>
      </header>

      <Card>
        <div className="flex flex-col gap-5">
          <Field label="Archivo .p12 / .pfx">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm transition-colors hover:border-brand-500/60 dark:border-slate-700 dark:bg-slate-800/50">
              <UploadCloud className="h-5 w-5 text-brand-500" strokeWidth={2} />
              <span className="truncate text-slate-600 dark:text-slate-300">
                {file ? file.name : 'Elegir archivo…'}
              </span>
              <input
                type="file"
                accept=".p12,.pfx,application/x-pkcs12"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          </Field>

          <Field label="Contraseña del certificado" hint="Opcional — solo si tu .p12 la tiene.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Proteger en este dispositivo con
            </span>
            <MethodOption
              active={method === 'webauthn-prf'}
              disabled={!prfSupported}
              onClick={() => prfSupported && setMethod('webauthn-prf')}
              icon={<Fingerprint className="h-5 w-5" strokeWidth={2} />}
              title="Biometría / passkey"
              subtitle={prfSupported ? 'Recomendado · Face ID, Touch ID, Windows Hello' : 'No disponible en este navegador'}
            />
            <MethodOption
              active={method === 'pin'}
              onClick={() => setMethod('pin')}
              icon={<Lock className="h-5 w-5" strokeWidth={2} />}
              title="PIN / contraseña maestra"
              subtitle="Mínimo 6 caracteres"
            />
          </div>

          {method === 'pin' && (
            <Field label="PIN">
              <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </Field>
          )}

          {error && <Alert kind="error">{error}</Alert>}

          <Button onClick={handleImport} disabled={!file || busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" strokeWidth={2} />}
            {busy ? 'Importando…' : 'Importar y proteger'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function MethodOption({
  active,
  disabled,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50 ${
        active
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
      }`}
    >
      <span className={active ? 'text-brand-600' : 'text-slate-400'}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-slate-500">{subtitle}</span>
      </span>
      <span
        className={`ml-auto h-4 w-4 shrink-0 rounded-full border-2 ${
          active ? 'border-brand-500 bg-brand-500' : 'border-slate-300 dark:border-slate-600'
        }`}
      />
    </button>
  )
}

function StoredCert({ vault }: { vault: Vault }) {
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const u = vault.unlocked

  async function handleUnlock() {
    setBusy(true)
    setError(null)
    try {
      await vault.unlock(vault.method === 'pin' ? pin : undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Certificado</h2>
        <p className="mt-1 text-sm text-slate-500">Guardado y cifrado en este dispositivo.</p>
      </header>

      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
            <FileBadge className="h-6 w-6" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight">
                {u ? u.subject.commonName : 'Certificado protegido'}
              </span>
              {u ? (
                <Badge tone="success">
                  <Unlock className="h-3 w-3" strokeWidth={2} />
                  Desbloqueado
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <Lock className="h-3 w-3" strokeWidth={2} />
                  Bloqueado
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Protección:{' '}
              {vault.method === 'webauthn-prf' ? 'Biometría / passkey' : 'PIN / contraseña maestra'}
            </p>
            {u && (
              <dl className="mt-3 grid grid-cols-[100px_1fr] gap-y-1 text-sm">
                {u.subject.personTypeLabel && (
                  <>
                    <dt className="text-slate-400">Tipo</dt>
                    <dd>{u.subject.personTypeLabel}</dd>
                  </>
                )}
                {u.subject.identification && (
                  <>
                    <dt className="text-slate-400">Cédula</dt>
                    <dd className="font-mono text-[12px]">{u.subject.identification}</dd>
                  </>
                )}
                {u.subject.companyName && (
                  <>
                    <dt className="text-slate-400">Razón social</dt>
                    <dd>{u.subject.companyName}</dd>
                  </>
                )}
                {u.subject.position && (
                  <>
                    <dt className="text-slate-400">Cargo</dt>
                    <dd>{u.subject.position}</dd>
                  </>
                )}
                {u.subject.companyRuc && (
                  <>
                    <dt className="text-slate-400">
                      {u.subject.personType === 'juridica' ? 'RUC empresa' : 'RUC'}
                    </dt>
                    <dd className="font-mono text-[12px]">{u.subject.companyRuc}</dd>
                  </>
                )}
                <dt className="text-slate-400">Válido hasta</dt>
                <dd>{formatDate(u.validTo)}</dd>
              </dl>
            )}
          </div>
        </div>

        {!u && (
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200/70 pt-4 dark:border-slate-800">
            {vault.method === 'pin' && (
              <Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
            )}
            {error && <Alert kind="error">{error}</Alert>}
            <Button onClick={handleUnlock} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Unlock className="h-4 w-4" strokeWidth={2} />}
              {busy ? 'Desbloqueando…' : 'Desbloquear'}
            </Button>
          </div>
        )}

        {u && (
          <p className="mt-4 flex items-center gap-1.5 border-t border-slate-200/70 pt-4 text-xs text-emerald-600 dark:border-slate-800">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Listo para firmar.
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" strokeWidth={2} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">Derecho de supresión (LOPDA)</h3>
            <p className="mt-1 text-sm text-slate-500">
              Borra el certificado y todos sus datos de forma irreversible.
            </p>
            <div className="mt-3">
              {confirmWipe ? (
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => vault.wipe()}>
                    Sí, borrar todo
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmWipe(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmWipe(true)}>
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                  Borrar certificado
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
