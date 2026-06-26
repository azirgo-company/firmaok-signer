import { useState } from 'react'
import {
  BadgeCheck,
  ShieldX,
  ChevronDown,
  UploadCloud,
  RotateCcw,
  AlertTriangle,
  FileText,
  Clock,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Skeleton } from '../components/ui'
import { readFileBytes } from '../lib/file'
import { validatePdf, type SignatureReport } from '../modules/pdf-validator'
import { PdfThumbnail } from '../modules/pdf-viewer/PdfThumbnail'

export function ValidatePage() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [reports, setReports] = useState<SignatureReport[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')

  async function handlePick(file: File) {
    setBusy(true)
    setError(null)
    setReports(null)
    setPdfBytes(null)
    setFileName(file.name)
    try {
      const bytes = await readFileBytes(file)
      setPdfBytes(bytes)
      await new Promise((r) => setTimeout(r, 30)) // deja pintar el loading
      setReports(await validatePdf(bytes))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setReports(null)
    setPdfBytes(null)
    setFileName('')
    setError(null)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Validar firmas</h2>
        <p className="mt-1 text-sm text-slate-500">
          Todo se procesa en tu navegador. El PDF nunca se sube a un servidor.
        </p>
      </header>

      {!pdfBytes && <Dropzone onPick={handlePick} />}
      {error && <Alert kind="error">{error}</Alert>}

      {pdfBytes && (
        <div className="grid gap-6 md:grid-cols-[340px_1fr]">
          <aside className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
              <span className="min-w-0 truncate" title={fileName}>
                {fileName}
              </span>
            </div>
            <PdfThumbnail pdfBytes={pdfBytes} width={340} />
            <Button variant="ghost" onClick={reset} className="w-full">
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
              Validar otro PDF
            </Button>
          </aside>

          <section className="flex min-w-0 flex-col gap-4">
            {busy && <LoadingSkeletons />}

            {!busy && reports && reports.length === 0 && (
              <Alert kind="info">Este PDF no contiene firmas electrónicas.</Alert>
            )}

            {!busy && reports && reports.length > 0 && (
              <>
                <p className="text-sm text-slate-500">{summarize(reports)}</p>
                {reports.map((r) => (
                  <SignatureCard key={r.index} r={r} />
                ))}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Dropzone({ onPick }: { onPick: (f: File) => void }) {
  const [over, setOver] = useState(false)
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onPick(f)
      }}
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        over
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
          : 'border-slate-300 bg-white hover:border-brand-500/60 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/50'
      }`}
    >
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
        <UploadCloud className="h-6 w-6" strokeWidth={2} />
      </span>
      <div>
        <p className="text-sm font-medium">Arrastra un PDF aquí o haz clic para elegir</p>
        <p className="mt-0.5 text-xs text-slate-400">Se analiza localmente. Nada se sube.</p>
      </div>
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
    </label>
  )
}

function LoadingSkeletons() {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </Card>
  )
}

function SignatureCard({ r }: { r: SignatureReport }) {
  const [open, setOpen] = useState(false)
  const ok = r.integrityValid
  const isTimestamp = r.kind === 'timestamp'

  // Cabecera neutra (azul) para sellos de tiempo; verde/rojo para firmas de persona.
  const headerBg = isTimestamp
    ? 'bg-sky-50/70 dark:bg-sky-950/20'
    : ok
      ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
      : 'bg-rose-50/60 dark:bg-rose-950/20'

  return (
    <Card padded={false} className="overflow-hidden">
      <div className={`flex items-start gap-3 p-5 ${headerBg}`}>
        {isTimestamp ? (
          <Clock className="mt-0.5 h-6 w-6 shrink-0 text-sky-600" strokeWidth={2} />
        ) : ok ? (
          <BadgeCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" strokeWidth={2} />
        ) : (
          <ShieldX className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" strokeWidth={2} />
        )}
        <div className="min-w-0">
          {isTimestamp ? (
            <>
              <p className="font-semibold tracking-tight text-sky-800 dark:text-sky-200">
                Sello de tiempo del documento
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Garantiza la fecha del documento, emitido por una Autoridad de Sellado (TSA).
              </p>
              <div className="mt-2 text-sm">
                <p className="text-xs text-slate-500">Autoridad (TSA)</p>
                <p className="font-medium leading-snug break-words">
                  {r.organization || r.signerName}
                </p>
                {r.signingTime && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Fecha del sello:{' '}
                    <span className="text-slate-700 dark:text-slate-300">
                      {r.signingTime.toLocaleString()}
                    </span>
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={`font-semibold tracking-tight ${
                    ok ? 'text-emerald-800 dark:text-emerald-200' : 'text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {ok ? 'Firma válida' : 'Firma inválida'}
                </p>
                {r.hasDocTimestamp && (
                  <Badge tone="brand">
                    <Clock className="h-3 w-3" strokeWidth={2} />
                    Con sello de tiempo
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {ok
                  ? 'La firma es auténtica y el documento no fue modificado.'
                  : 'No se pudo verificar la integridad de esta firma.'}
              </p>
              <div className="mt-2 text-sm">
                <p className="text-xs text-slate-500">Firmante</p>
                <p className="font-medium leading-snug break-words">{r.signerName}</p>
                {r.identification && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Cédula / RUC:{' '}
                    <span className="font-mono text-slate-700 dark:text-slate-300">
                      {r.identification}
                    </span>
                  </p>
                )}
              </div>
              {r.certExpired && (
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
                  Certificado vencido a la fecha actual
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200/70 dark:border-slate-800">
        <button
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
          onClick={() => setOpen((o) => !o)}
        >
          <span>Detalle técnico</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>

        {open && (
          <div className="space-y-5 px-5 pb-5 text-sm">
            <Section title="Firmante">
              <Row k="Nombre (CN)" v={r.signerName} />
              <Row k="Organización" v={r.organization} />
              <Row k="Unidad (OU)" v={r.organizationalUnit} />
              <Row k="ID / RUC" v={r.identification} mono />
            </Section>
            <Section title="Emisor">
              <Row k="Emisor (CN)" v={r.issuer} />
              <Row k="Root CA" v={r.rootCa} />
            </Section>
            <Section title="Certificado">
              <Row k="Desde" v={r.certValidFrom?.toLocaleString()} />
              <Row k="Hasta" v={r.certValidTo?.toLocaleString()} />
              <Row k="Huella SHA-256" v={r.certFingerprintSha256} mono wrap />
            </Section>
            <Section title="Firma">
              <Row k="Perfil PAdES" v={r.padesProfile} badge />
              <Row k="Hash" v={r.hashAlgorithm} mono />
              <Row k="Algoritmo" v={r.signatureAlgorithm} mono />
              <Row k="Fecha declarada" v={r.signingTime?.toLocaleString() ?? '—'} />
              <Row k="Razón" v={r.reason} />
              <Row k="Lugar" v={r.location} />
            </Section>
            <Section title="Integridad">
              <Row k="Hash del documento" v={ok ? 'Coincide (íntegro)' : 'No coincide'} />
              <Row
                k="Cambios tras firmar"
                v={
                  r.appendedBytesAfter > 0
                    ? `${r.appendedBytesAfter.toLocaleString()} bytes añadidos después (normal en multifirma/LTV)`
                    : 'Ninguno'
                }
              />
              <Row k="Bytes cubiertos" v={r.coveredBytes.toLocaleString()} mono />
              <Row k="Bytes totales" v={r.totalBytes.toLocaleString()} mono />
            </Section>
            <Section title="Revocación">
              <Row k="OCSP / CRL" v="No verificado (modo offline)" />
            </Section>
            <p className="text-xs leading-relaxed text-slate-400">{r.trustNote}</p>
          </div>
        )}
      </div>
    </Card>
  )
}

function summarize(reports: SignatureReport[]): string {
  const sigs = reports.filter((r) => r.kind === 'signature').length
  const ts = reports.filter((r) => r.kind === 'timestamp').length
  const parts = [`${sigs} ${sigs === 1 ? 'firma' : 'firmas'}`]
  if (ts > 0) parts.push(`${ts} sello${ts === 1 ? '' : 's'} de tiempo`)
  return parts.join(' · ')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h4>
      <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5">{children}</dl>
    </div>
  )
}

function Row({
  k,
  v,
  mono,
  wrap,
  badge,
}: {
  k: string
  v?: string
  mono?: boolean
  wrap?: boolean
  badge?: boolean
}) {
  if (!v) return null
  return (
    <>
      <dt className="text-slate-400">{k}</dt>
      <dd
        className={`min-w-0 text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-[12px]' : ''} ${
          wrap ? 'break-all' : 'truncate'
        }`}
      >
        {badge ? <Badge tone="brand">{v}</Badge> : v}
      </dd>
    </>
  )
}
