import { useEffect, useState } from 'react'
import {
  UploadCloud,
  KeyRound,
  Download,
  RotateCcw,
  FileText,
  CheckCircle2,
  IdCard,
  ArrowRight,
  Check,
} from 'lucide-react'
import { Alert, Badge, Button, Card, EmptyState, Input, Spinner } from '../components/ui'
import { downloadBytes, readFileBytes } from '../lib/file'
import { PdfSignCanvas } from '../modules/pdf-viewer/PdfSignCanvas'
import { signPdf, type SignaturePosition } from '../modules/pdf-signer'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

export function SignPage({ vault, onGoToCert }: { vault: Vault; onGoToCert: () => void }) {
  const certs = vault.certificates
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [position, setPosition] = useState<SignaturePosition | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pin, setPin] = useState('')

  // Selección por defecto: el certificado activo, o el primero.
  useEffect(() => {
    if (!selectedId && certs.length) setSelectedId(vault.activeId ?? certs[0].id)
  }, [certs, vault.activeId, selectedId])

  const selected = certs.find((c) => c.id === selectedId) ?? null
  const ready = !!vault.unlocked && vault.activeId === selectedId
  const u = ready ? vault.unlocked : null
  const signerAppearance = u
    ? {
        name: u.subject.commonName,
        identification: u.subject.identification,
        isCompany: u.subject.personType === 'juridica',
        companyName: u.subject.companyName,
        position: u.subject.position,
        companyRuc: u.subject.companyRuc,
      }
    : undefined

  if (!vault.hasCertificate) {
    return (
      <EmptyState
        icon={<IdCard className="h-8 w-8" strokeWidth={1.75} />}
        title="Primero, tu certificado"
        description="Para firmar documentos necesitas tu certificado de firma (.p12). Se importa una sola vez y se guarda cifrado en este dispositivo."
      >
        <Button onClick={onGoToCert}>
          <IdCard className="h-4 w-4" strokeWidth={2} />
          Importar certificado
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Button>
      </EmptyState>
    )
  }

  async function handleUnlock() {
    if (!selected) return
    setError(null)
    setBusy(true)
    try {
      await vault.unlock(selected.id, pin)
      setPin('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handlePickPdf(file: File) {
    setDone(false)
    setError(null)
    setPdf({ name: file.name, bytes: await readFileBytes(file) })
  }

  async function handleSign() {
    if (!pdf || !position || !u) return
    setBusy(true)
    setError(null)
    try {
      const signed = await signPdf({
        pdfBytes: pdf.bytes,
        vault: u,
        appearance: signerAppearance ?? { name: u.subject.commonName },
        position,
      })
      downloadBytes(signed, pdf.name.replace(/\.pdf$/i, '') + '-firmado.pdf')
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // No desbloqueado aún: selector + desbloqueo.
  if (!u) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-12">
        <header className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Firmar PDF</h2>
          <p className="mt-1 text-sm text-slate-500">Elige el certificado y desbloquéalo para firmar.</p>
        </header>

        <CertSelector certs={certs} selectedId={selectedId} onSelect={setSelectedId} />

        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
              <KeyRound className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ingresa tu contraseña maestra para usar este certificado.
            </p>
          </div>
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Contraseña maestra"
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          />
          {error && <Alert kind="error">{error}</Alert>}
          <Button onClick={handleUnlock} disabled={busy || !pin}>
            {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" strokeWidth={2} />}
            {busy ? 'Desbloqueando…' : 'Desbloquear'}
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Firmar PDF</h2>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Firmando con este certificado
            </p>
            <p className="mt-1 font-semibold leading-snug break-words">{u.subject.commonName}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              {u.subject.personTypeLabel && <Badge tone="brand">{u.subject.personTypeLabel}</Badge>}
              {u.subject.identification && (
                <span>
                  Cédula <span className="font-mono">{u.subject.identification}</span>
                </span>
              )}
              {u.subject.companyName && <span>· {u.subject.companyName}</span>}
              {u.subject.position && <span>· {u.subject.position}</span>}
              {u.subject.companyRuc && (
                <span>
                  · RUC <span className="font-mono">{u.subject.companyRuc}</span>
                </span>
              )}
            </div>
          </div>
          {certs.length > 1 && (
            <Button variant="ghost" onClick={vault.lock}>
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Cambiar
            </Button>
          )}
        </div>
      </header>

      {!pdf ? (
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center transition-colors hover:border-brand-500/60 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/50">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
            <UploadCloud className="h-6 w-6" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-medium">Arrastra el PDF a firmar o haz clic</p>
            <p className="mt-0.5 text-xs text-slate-400">Se firma localmente. Nada se sube.</p>
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handlePickPdf(e.target.files[0])}
          />
        </label>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_300px]">
          <Card padded={false} className="min-w-0 overflow-hidden p-3">
            <PdfSignCanvas
              pdfBytes={pdf.bytes}
              onPositionChange={setPosition}
              preview={signerAppearance}
            />
          </Card>

          <div className="flex min-w-0 flex-col gap-4">
            {error && <Alert kind="error">{error}</Alert>}
            {done && (
              <Alert kind="success">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  PDF firmado y descargado.
                </span>
              </Alert>
            )}

            <Button onClick={handleSign} disabled={busy || !position}>
              {busy ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" strokeWidth={2} />}
              {busy ? 'Firmando…' : 'Firmar y descargar'}
            </Button>
            <Button variant="ghost" onClick={() => setPdf(null)}>
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Elegir otro PDF
            </Button>

            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              Arrastra el recuadro azul sobre el documento.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function CertSelector({
  certs,
  selectedId,
  onSelect,
}: {
  certs: Vault['certificates']
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (certs.length <= 1) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Firmar con</span>
      <div className="flex flex-col gap-2">
        {certs.map((c) => {
          const active = c.id === selectedId
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                active
                  ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.label}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[c.subjectType, c.companyName].filter(Boolean).join(' · ') || 'Certificado'}
                  {c.expired && ' · vencido'}
                </span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-brand-600" strokeWidth={2.5} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
