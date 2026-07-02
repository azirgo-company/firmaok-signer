import { useState } from 'react'
import {
  ShieldCheck,
  Trash2,
  UploadCloud,
  Unlock,
  CheckCircle2,
  FileBadge,
  Plus,
  ArrowLeft,
  ChevronDown,
  KeyRound,
  AlertTriangle,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Field, Input, Spinner } from '../components/ui'
import { readFileBytes } from '../lib/file'
import { formatDate } from '../lib/date'
import { MASTER_MIN_LENGTH, type CertSummary } from '../modules/cert-vault/vault'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

export function CertPage({ vault, onClose }: { vault: Vault; onClose?: () => void }) {
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

  return (
    <CertList vault={vault} onImportAnother={() => setImporting(true)} onClose={onClose} />
  )
}

// ---------- Medidor de fortaleza ----------

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let s = 0
  if (pw.length >= MASTER_MIN_LENGTH) s++
  if (pw.length >= 16) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw) || /[^a-zA-Z0-9]/.test(pw)) s++
  if (/\s/.test(pw) && pw.length >= 16) s = Math.max(s, 3) // frase larga
  s = Math.min(s, 4)
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte']
  const colors = ['bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500']
  return { score: s, label: labels[s], color: colors[s] }
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
  const firstTime = !vault.hasMaster
  const [file, setFile] = useState<File | null>(null)
  const [certPassword, setCertPassword] = useState('')
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const strength = passwordStrength(master)
  const tooShort = firstTime && master.length > 0 && master.length < MASTER_MIN_LENGTH
  const canSubmit = !!file && master.length >= (firstTime ? MASTER_MIN_LENGTH : 1)

  async function handleImport() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await readFileBytes(file)
      await vault.importCertificate(bytes, {
        certPassword: certPassword || undefined,
        masterPassword: master,
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
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
              value={certPassword}
              onChange={(e) => setCertPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <Field
            label={firstTime ? 'Crea tu contraseña maestra' : 'Tu contraseña maestra'}
            hint={
              firstTime
                ? `Protege todos tus certificados. Usa una frase larga; mínimo ${MASTER_MIN_LENGTH} caracteres.`
                : 'La que usaste al guardar tu primer certificado.'
            }
          >
            <Input
              type="password"
              value={master}
              onChange={(e) => setMaster(e.target.value)}
              placeholder={firstTime ? 'Una frase que solo tú conozcas' : 'Contraseña maestra'}
            />
          </Field>

          {firstTime && master.length > 0 && (
            <div className="-mt-2 flex flex-col gap-1">
              <div className="flex h-1.5 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-full flex-1 rounded-full ${
                      i < strength.score ? strength.color : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-slate-400">Fortaleza: {strength.label}</span>
            </div>
          )}

          {firstTime && (
            <Alert kind="info">
              <span className="inline-flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                Guárdala bien: <strong>no se puede recuperar</strong>. Si la olvidas, podrás volver a
                importar tu .p12.
              </span>
            </Alert>
          )}

          {tooShort && (
            <p className="text-xs font-medium text-amber-600">
              La contraseña maestra debe tener al menos {MASTER_MIN_LENGTH} caracteres.
            </p>
          )}
          {error && <Alert kind="error">{error}</Alert>}

          <Button onClick={handleImport} disabled={!canSubmit || busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" strokeWidth={2} />}
            {busy ? 'Importando…' : 'Importar y proteger'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function CertList({
  vault,
  onImportAnother,
  onClose,
}: {
  vault: Vault
  onImportAnother: () => void
  onClose?: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8">
      {onClose && (
        <Button variant="ghost" onClick={onClose} className="-mb-2 self-start">
          <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          Volver a firmar
        </Button>
      )}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Mis certificados</h2>
          <p className="mt-1 text-sm text-slate-500">Guardados y cifrados en este dispositivo.</p>
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
  const [master, setMaster] = useState('')
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
      await vault.unlock(cert.id, master)
      setMaster('')
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
                <KeyRound className="h-3 w-3" strokeWidth={2} />
                Bloqueado
              </Badge>
            )}
            {cert.expired && <Badge tone="danger">Vencido</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {[cert.subjectType, cert.companyName].filter(Boolean).join(' · ')}
            {cert.subjectType && cert.validTo && ' · '}
            {cert.validTo && `válido hasta ${formatDate(cert.validTo)}`}
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

      {!isUnlocked && (
        <div className="border-t border-slate-200/70 px-5 py-4 dark:border-slate-800">
          {open ? (
            <div className="flex flex-col gap-3">
              <Input
                type="password"
                value={master}
                onChange={(e) => setMaster(e.target.value)}
                placeholder="Contraseña maestra"
              />
              {error && <Alert kind="error">{error}</Alert>}
              <div className="flex gap-2">
                <Button onClick={handleUnlock} disabled={busy || !master}>
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
