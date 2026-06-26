import { useState } from 'react'
import {
  UploadCloud,
  Lock,
  Fingerprint,
  Download,
  RotateCcw,
  FileText,
  CheckCircle2,
  IdCard,
  ArrowRight,
} from 'lucide-react'
import { Alert, Button, Card, EmptyState, Input, Spinner } from '../components/ui'
import { downloadBytes, readFileBytes } from '../lib/file'
import { PdfSignCanvas } from '../modules/pdf-viewer/PdfSignCanvas'
import { signPdf, type SignaturePosition } from '../modules/pdf-signer'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

export function SignPage({ vault, onGoToCert }: { vault: Vault; onGoToCert: () => void }) {
  const [pdf, setPdf] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [position, setPosition] = useState<SignaturePosition | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pin, setPin] = useState('')

  const u = vault.unlocked

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
    setError(null)
    setBusy(true)
    try {
      await vault.unlock(vault.method === 'pin' ? pin : undefined)
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
        appearance: {
          name: u.subject.commonName,
          identification: u.subject.identification,
        },
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

  if (!u) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-600">
            {vault.method === 'pin' ? <Lock className="h-6 w-6" strokeWidth={2} /> : <Fingerprint className="h-6 w-6" strokeWidth={2} />}
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Desbloquea para firmar</h2>
            <p className="mt-1 text-sm text-slate-500">
              {vault.method === 'pin'
                ? 'Ingresa tu PIN para usar el certificado.'
                : 'Confirma con tu biometría para usar el certificado.'}
            </p>
          </div>
          {vault.method === 'pin' && (
            <Input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              className="w-full text-center"
            />
          )}
          {error && <Alert kind="error">{error}</Alert>}
          <Button onClick={handleUnlock} disabled={busy} className="w-full">
            {busy ? <Spinner className="h-4 w-4" /> : vault.method === 'pin' ? <Lock className="h-4 w-4" strokeWidth={2} /> : <Fingerprint className="h-4 w-4" strokeWidth={2} />}
            {busy ? 'Desbloqueando…' : 'Desbloquear'}
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Firmar PDF</h2>
        <p className="mt-1 text-sm text-slate-500">
          Firmando como <span className="font-medium text-slate-700 dark:text-slate-200">{u.subject.commonName}</span>
        </p>
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
            <PdfSignCanvas pdfBytes={pdf.bytes} onPositionChange={setPosition} />
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
