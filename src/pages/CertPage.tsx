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
  Plus,
  ArrowLeft,
  ChevronDown,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Field, Input, Spinner } from '../components/ui'
import { readFileBytes } from '../lib/file'
import { formatDate } from '../lib/date'
import {
  isWebAuthnPrfSupported,
  PrfUnsupportedError,
  type ProtectionMethod,
} from '../modules/cert-vault/key-protection'
import type { CertSummary } from '../modules/cert-vault/vault'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

export function CertPage({ vault }: { vault: Vault }) {
  const [importing, setImporting] = useState(false)

  if (vault.loading)
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-slate-500">
        <Spinner className="h-6 w-6 text-brand-500" />
      </div>
    )

  if (vault.certificates.length === 0 || importing) {
    return (
      <ImportCert
        vault={vault}
        canCancel={vault.certificates.length > 0}
        onDone={() => setImporting(false)}
      />
    )
  }

  return <CertList vault={vault} onImportAnother={() => setImporting(true)} />
}

function ImportCert({
  vault,
  canCancel,
  onDone,
}: {
  vault: Vault
  canCancel: boolean
  onDone: () => void
}) {
  const prfSupported = isWebAuthnPrfSupported()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [method, setMethod] = useState<ProtectionMethod>(prfSupported ? 'webauthn-prf' : 'pin')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pinTooShort = method === 'pin' && pin.length > 0 && pin.length < 10

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
      onDone()
    } catch (e) {
      if (e instanceof PrfUnsupportedError || (e as Error)?.name === 'PrfUnsupportedError') {
        // Biometría no disponible (gestor externo como Dashlane, o Touch ID local sin PRF):
        // cambiamos a contraseña maestra automáticamente.
        setMethod('pin')
        setError(
          'No se pudo usar biometría: parece que un gestor externo (p. ej. Dashlane) interceptó, o tu Touch ID local no soporta el cifrado PRF. Crea una contraseña maestra para continuar.',
        )
      } else {
        setError((e as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Importar certificado</h2>
          <p className="mt-1 text-sm text-slate-500">
            Súbelo una sola vez. Se guarda cifrado en este dispositivo; no se vuelve a pedir el archivo.
          </p>
        </div>
        {canCancel && (
          <Button variant="ghost" onClick={onDone}>
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
            Volver
          </Button>
        )}
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
              subtitle={
                prfSupported
                  ? 'Recomendado · la opción más segura (ligada al hardware)'
                  : 'No disponible en este navegador'
              }
            />
            <MethodOption
              active={method === 'pin'}
              onClick={() => setMethod('pin')}
              icon={<Lock className="h-5 w-5" strokeWidth={2} />}
              title="Contraseña maestra"
              subtitle="Usa una frase larga; mínimo 10 caracteres"
            />
          </div>

          {method === 'pin' && (
            <Field
              label="Contraseña maestra"
              hint="Cuanto más larga, más segura. Mínimo 10 caracteres."
            >
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Una frase que solo tú conozcas"
              />
            </Field>
          )}

          {pinTooShort && (
            <p className="text-xs font-medium text-amber-600">
              La contraseña maestra debe tener al menos 10 caracteres.
            </p>
          )}
          {error && <Alert kind="error">{error}</Alert>}

          <Button
            onClick={handleImport}
            disabled={!file || busy || (method === 'pin' && pin.length < 10)}
          >
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

function CertList({ vault, onImportAnother }: { vault: Vault; onImportAnother: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Mis certificados</h2>
          <p className="mt-1 text-sm text-slate-500">
            Guardados y cifrados en este dispositivo.
          </p>
        </div>
        <Button onClick={onImportAnother}>
          <Plus className="h-4 w-4" strokeWidth={2} />
          Importar otro
        </Button>
      </header>

      {vault.certificates.map((cert) => (
        <CertCard key={cert.id} cert={cert} vault={vault} />
      ))}

      <p className="mt-1 text-xs text-slate-400">
        Borra cualquier certificado en cualquier momento (derecho de supresión, LOPDA). La acción es
        irreversible.
      </p>
    </div>
  )
}

function CertCard({ cert, vault }: { cert: CertSummary; vault: Vault }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isUnlocked = vault.activeId === cert.id && !!vault.unlocked
  const u = isUnlocked ? vault.unlocked : null

  async function handleUnlock() {
    setBusy(true)
    setError(null)
    try {
      await vault.unlock(cert.id, cert.method === 'pin' ? pin : undefined)
      setOpen(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-start gap-3 p-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
          <FileBadge className="h-6 w-6" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-tight break-words">{cert.label}</span>
            {isUnlocked ? (
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
            {cert.expired && <Badge tone="danger">Vencido</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {cert.method === 'webauthn-prf' ? 'Biometría / passkey' : 'Contraseña maestra'}
            {cert.validTo && ` · válido hasta ${formatDate(cert.validTo)}`}
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
            </dl>
          )}
        </div>
      </div>

      {/* Desbloquear para ver detalles */}
      {!isUnlocked && (
        <div className="border-t border-slate-200/70 px-5 py-4 dark:border-slate-800">
          {open ? (
            <div className="flex flex-col gap-3">
              {cert.method === 'pin' && (
                <Input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Contraseña maestra"
                />
              )}
              {error && <Alert kind="error">{error}</Alert>}
              <div className="flex gap-2">
                <Button onClick={handleUnlock} disabled={busy}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Unlock className="h-4 w-4" strokeWidth={2} />}
                  {busy ? 'Desbloqueando…' : 'Desbloquear'}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="flex items-center gap-1.5 text-sm font-medium text-brand-600"
              onClick={() => setOpen(true)}
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
              Desbloquear para ver detalles
            </button>
          )}
        </div>
      )}

      {isUnlocked && (
        <p className="flex items-center gap-1.5 border-t border-slate-200/70 px-5 py-3 text-xs text-emerald-600 dark:border-slate-800">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
          Listo para firmar.
        </p>
      )}

      {/* Borrar */}
      <div className="border-t border-slate-200/70 px-5 py-3 dark:border-slate-800">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">¿Borrar este certificado?</span>
            <Button variant="danger" onClick={() => vault.deleteCertificate(cert.id)}>
              Sí, borrar
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 text-sm font-medium text-rose-600"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
            Borrar certificado
          </button>
        )}
      </div>
    </Card>
  )
}
