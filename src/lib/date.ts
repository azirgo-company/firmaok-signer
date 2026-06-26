// Formato de fecha consistente y legible (estándar Ecuador: DD/MM/YYYY).
// Formateo manual para evitar diferencias de locale entre navegadores.

const pad = (n: number) => String(n).padStart(2, '0')

/** "26/06/2026" */
export function formatDate(d?: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** "26/06/2026 14:00:01" */
export function formatDateTime(d?: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '—'
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
