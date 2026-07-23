import { useEffect, useMemo, useState } from 'react'
import {
  UploadCloud,
  KeyRound,
  Download,
  RotateCcw,
  FileText,
  CheckCircle2,
  IdCard,
  Check,
  CalendarDays,
  BriefcaseBusiness,
  ZoomIn,
  Share2,
} from 'lucide-react'
import { CalendarX2 } from 'lucide-react'
import { Alert, Badge, Button, Card, Input, Modal, Spinner } from '../components/ui'
import { canSharePdfFiles, downloadBytes, makePdfFile, readFileBytes, shareFile } from '../lib/file'
import { formatDate } from '../lib/date'
import { trackEvent } from '../lib/analytics'
import { PdfSignCanvas } from '../modules/pdf-viewer/PdfSignCanvas'
import { StampPreview, useStampDims } from '../modules/pdf-viewer/StampPreview'
import { useContainerWidth } from '../modules/pdf-viewer/useContainerWidth'
import { signPdf, type SignaturePosition, type SignatureAppearance } from '../modules/pdf-signer'
import { CertPage } from './CertPage'
import type { useVault } from '../modules/cert-vault/useVault'

type Vault = ReturnType<typeof useVault>

// Tope de la nota del sello (el contenido visible se envuelve a un máx. de 2 líneas).
const NOTES_MAX = 100

// Mensaje que acompaña al PDF en la hoja de compartir; el https:// hace que el
// enlace sea clickeable en WhatsApp, correo, etc.
const SHARE_TEXT = 'Firmado con FirmaOK - https://firmaok.com.ec'

export function SignPage({ vault }: { vault: Vault }) {
  const certs = vault.certificates
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [position, setPosition] = useState<SignaturePosition | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Acción de firma en curso ('download' | 'share') para el estado de los botones.
  const [busyAction, setBusyAction] = useState<'download' | 'share' | null>(null)
  // PDF ya firmado, retenido para poder compartirlo como archivo con la hoja
  // nativa (navigator.share) o volver a descargarlo sin re-firmar. Compartir
  // la descarga desde el visor del navegador pega la URL blob: como texto, y
  // ese enlace no sirve fuera de este dispositivo.
  const [signedFile, setSignedFile] = useState<File | null>(null)
  const shareSupported = useMemo(() => canSharePdfFiles(), [])
  const [pin, setPin] = useState('')
  // Gestión de certificados (importar / ver detalles / borrar) embebida en este tab.
  const [managing, setManaging] = useState(false)
  // La fecha en el sello es opcional; por defecto no se incluye.
  const [includeDate, setIncludeDate] = useState(false)
  // El cargo (persona jurídica) también es opcional; por defecto no se incluye.
  const [includePosition, setIncludePosition] = useState(false)
  // Nota libre opcional en el sello (máximo 2 líneas).
  const [notes, setNotes] = useState('')

  // Selección por defecto: el certificado activo, o el primero.
  useEffect(() => {
    if (!selectedId && certs.length) setSelectedId(vault.activeId ?? certs[0].id)
  }, [certs, vault.activeId, selectedId])

  const selected = certs.find((c) => c.id === selectedId) ?? null
  const ready = !!vault.unlocked && vault.activeId === selectedId
  const u = ready ? vault.unlocked : null
  const now = Date.now()
  const selectedExpired = !!selected?.expired
  const unlockedInvalid = !!u && (u.validTo.getTime() < now || u.validFrom.getTime() > now)
  const signerAppearance = u
    ? {
        name: u.subject.commonName,
        identification: u.subject.identification,
        isCompany: u.subject.personType === 'juridica',
        companyName: u.subject.companyName,
        position: includePosition ? u.subject.position : undefined,
        companyRuc: u.subject.companyRuc,
        includeDate,
        notes,
      }
    : undefined

  // Gestión de certificados embebida: al pulsar "Administrar" o cuando aún no hay
  // ningún certificado, mostramos aquí mismo la pantalla de importar/gestionar
  // (antes era un tab aparte). CertPage resuelve el estado de carga internamente.
  if (managing || !vault.hasCertificate) {
    return <CertPage vault={vault} onClose={managing ? () => setManaging(false) : undefined} />
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
    setSignedFile(null)
    setError(null)
    setNotice(null)
    setPdf({ name: file.name, bytes: await readFileBytes(file) })
  }

  async function handleSign(action: 'download' | 'share') {
    if (!pdf || !position || !u) return
    setBusyAction(action)
    setError(null)
    setNotice(null)
    try {
      const signed = await signPdf({
        pdfBytes: pdf.bytes,
        vault: u,
        appearance: signerAppearance ?? { name: u.subject.commonName },
        position,
      })
      const filename = pdf.name.replace(/\.pdf$/i, '') + '-firmado.pdf'
      const file = makePdfFile(signed, filename)
      setSignedFile(file)
      trackEvent('pdf_firmado', { metodo: action })
      if (action === 'download') {
        downloadBytes(signed, filename)
      } else {
        try {
          await shareFile(file, SHARE_TEXT)
        } catch {
          // Algunos navegadores exigen que compartir ocurra justo tras el toque;
          // si la firma tardó demasiado queda el botón del panel de éxito.
          setNotice('El PDF ya está firmado. Toca "Compartir PDF firmado" para abrir la hoja de compartir.')
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleShare() {
    if (!signedFile) return
    try {
      await shareFile(signedFile, SHARE_TEXT)
    } catch {
      setError('No se pudo abrir la hoja de compartir. Descarga el PDF y compártelo desde tus archivos.')
    }
  }

  async function handleDownloadAgain() {
    if (!signedFile) return
    downloadBytes(new Uint8Array(await signedFile.arrayBuffer()), signedFile.name)
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

        {selectedExpired ? (
          <ExpiredCert
            name={selected?.label ?? 'Este certificado'}
            validTo={selected?.validTo}
            onImport={() => setManaging(true)}
          />
        ) : (
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
        )}

        <button
          type="button"
          onClick={() => setManaging(true)}
          className="mx-auto inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-brand-600 dark:hover:text-brand-500"
        >
          <IdCard className="h-4 w-4" strokeWidth={2} />
          Administrar certificados
        </button>
      </div>
    )
  }

  // Desbloqueado pero fuera de vigencia: no se permite firmar.
  if (unlockedInvalid && u) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-12">
        <header className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Firmar PDF</h2>
        </header>
        <ExpiredCert
          name={u.subject.commonName}
          validTo={u.validTo}
          notYetValid={u.validFrom.getTime() > now}
          onImport={() => setManaging(true)}
          onChange={certs.length > 1 ? vault.lock : undefined}
        />
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
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" onClick={() => setManaging(true)}>
              <IdCard className="h-4 w-4" strokeWidth={2} />
              Certificados
            </Button>
            {certs.length > 1 && (
              <Button variant="ghost" onClick={vault.lock}>
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Cambiar
              </Button>
            )}
          </div>
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
            {notice && <Alert kind="info">{notice}</Alert>}
            {signedFile && (
              <Alert kind="success">
                <div className="flex flex-col gap-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                    PDF firmado correctamente.
                  </span>
                  {shareSupported && (
                    <Button onClick={handleShare} className="w-full justify-center">
                      <Share2 className="h-4 w-4" strokeWidth={2} />
                      Compartir PDF firmado
                    </Button>
                  )}
                  <Button variant="ghost" onClick={handleDownloadAgain} className="w-full justify-center">
                    <Download className="h-4 w-4" strokeWidth={2} />
                    Descargar PDF firmado
                  </Button>
                </div>
              </Alert>
            )}

            {signerAppearance && <StampPreviewCard appearance={signerAppearance} />}

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
              <input
                type="checkbox"
                checked={includeDate}
                onChange={(e) => setIncludeDate(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-brand-600"
              />
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <CalendarDays className="h-4 w-4 text-slate-400" strokeWidth={2} />
                Incluir la fecha actual en la firma
              </span>
            </label>

            {u.subject.personType === 'juridica' && u.subject.position && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                <input
                  type="checkbox"
                  checked={includePosition}
                  onChange={(e) => setIncludePosition(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <BriefcaseBusiness className="h-4 w-4 text-slate-400" strokeWidth={2} />
                  Incluir el cargo en la firma
                </span>
              </label>
            )}

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="flex items-center justify-between font-medium text-slate-700 dark:text-slate-200">
                Notas
                <span className="text-xs font-normal tabular-nums text-slate-400">
                  {notes.length}/{NOTES_MAX}
                </span>
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={NOTES_MAX}
                placeholder="Nota opcional en la firma (máx. 2 líneas)"
                className="resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>

            {shareSupported && (
              <Button onClick={() => handleSign('share')} disabled={!!busyAction || !position}>
                {busyAction === 'share' ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Share2 className="h-4 w-4" strokeWidth={2} />
                )}
                {busyAction === 'share' ? 'Firmando…' : 'Firmar y compartir'}
              </Button>
            )}
            <Button
              variant={shareSupported ? 'ghost' : 'primary'}
              onClick={() => handleSign('download')}
              disabled={!!busyAction || !position}
            >
              {busyAction === 'download' ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" strokeWidth={2} />
              )}
              {busyAction === 'download' ? 'Firmando…' : 'Firmar y descargar'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPdf(null)
                setSignedFile(null)
                setNotice(null)
              }}
            >
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

/**
 * Sello sobre "papel" blanco, escalado al ancho disponible del contenedor.
 * Fondo blanco fijo (simula el documento) para que el texto oscuro se lea
 * también en modo oscuro.
 */
function StampPaper({ appearance }: { appearance: SignatureAppearance }) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const dims = useStampDims(appearance)
  const scale = width > 0 ? width / dims.width : 0
  return (
    <div ref={ref} className="w-full rounded-xl border border-dashed border-brand-500/70 bg-white">
      {scale > 0 && <StampPreview appearance={appearance} scale={scale} />}
    </div>
  )
}

/**
 * Preview estático del sello en el panel lateral: el MISMO componente que se
 * arrastra sobre el PDF. Al hacer clic se abre ampliado en un diálogo.
 */
function StampPreviewCard({ appearance }: { appearance: SignatureAppearance }) {
  const [zoomed, setZoomed] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
        Así se verá tu firma
        <span className="flex items-center gap-1 text-xs font-normal text-slate-400">
          <ZoomIn className="h-3.5 w-3.5" strokeWidth={2} />
          Ampliar
        </span>
      </span>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        title="Ver la firma ampliada"
        className="cursor-zoom-in rounded-xl outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        <StampPaper appearance={appearance} />
      </button>
      {zoomed && (
        <Modal title="Así se verá tu firma" onClose={() => setZoomed(false)}>
          <StampPaper appearance={appearance} />
        </Modal>
      )}
    </div>
  )
}

function ExpiredCert({
  name,
  validTo,
  notYetValid,
  onImport,
  onChange,
}: {
  name: string
  validTo?: Date
  notYetValid?: boolean
  onImport: () => void
  onChange?: () => void
}) {
  return (
    <Card className="flex flex-col items-center gap-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-600">
        <CalendarX2 className="h-6 w-6" strokeWidth={2} />
      </span>
      <div>
        <h3 className="text-lg font-semibold tracking-tight">
          {notYetValid ? 'Certificado aún no vigente' : 'Certificado vencido'}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          <span className="font-medium text-slate-700 dark:text-slate-200">{name}</span>{' '}
          {notYetValid
            ? 'todavía no está dentro de su periodo de validez.'
            : validTo
              ? `venció el ${formatDate(validTo)}.`
              : 'está fuera de su periodo de validez.'}{' '}
          No se puede firmar con un certificado fuera de vigencia.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button onClick={onImport} className="w-full justify-center">
          <IdCard className="h-4 w-4" strokeWidth={2} />
          Importar un certificado vigente
        </Button>
        {onChange && (
          <Button variant="ghost" onClick={onChange} className="w-full justify-center">
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Elegir otro certificado
          </Button>
        )}
      </div>
    </Card>
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
