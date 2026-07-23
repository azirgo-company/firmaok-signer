import { Modal } from './ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  )
}

/** Aviso de privacidad y términos (LOPDP + límites de la firma). */
export function LegalNotice({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Aviso de privacidad y términos" onClose={onClose}>
      <Section title="Procesamiento 100% local">
        <p>
          FirmaOK funciona enteramente en tu navegador. Tu certificado (.p12), su clave privada y
          los documentos que firmas o validas <strong>nunca se envían a ningún servidor</strong>: no
          hay backend que los reciba ni almacene.
        </p>
      </Section>

      <Section title="Datos personales (LOPDP)">
        <p>
          No recopilamos, transmitimos ni vendemos datos personales. Tu certificado se guarda
          <strong> cifrado en tu propio dispositivo</strong>; solo el nombre, el tipo de firmante y
          la razón social quedan sin cifrar para que puedas identificar tus certificados.
        </p>
        <p>
          El sitio se entrega desde un servidor web que, como cualquier sitio, puede registrar datos
          técnicos de acceso (p. ej. dirección IP) en sus bitácoras; esos registros no incluyen tus
          documentos ni tu certificado.
        </p>
        <p>
          Conforme a la Ley Orgánica de Protección de Datos Personales, puedes ejercer tus derechos
          de acceso, rectificación y <strong>supresión</strong>: elimina tu certificado y sus datos
          en cualquier momento desde «Firmar › Administrar certificados».
        </p>
      </Section>

      <Section title="Analítica de uso (Google Analytics)">
        <p>
          Usamos <strong>Google Analytics</strong> para medir el uso de la aplicación: páginas
          visitadas y eventos agregados como «certificado guardado», «PDF firmado» o «PDF
          validado». Estos eventos <strong>no incluyen</strong> el contenido de tus documentos, el
          nombre de tus archivos, tu certificado ni ningún dato personal identificable.
        </p>
        <p>
          Google Analytics puede usar identificadores propios y procesar tu dirección IP conforme a
          sus políticas. Si bloqueas estos scripts (p. ej. con un bloqueador de anuncios), la
          aplicación sigue funcionando con normalidad.
        </p>
      </Section>

      <Section title="Seguridad">
        <p>
          La clave privada se cifra con AES-256-GCM, protegida por una contraseña maestra derivada
          con Argon2id (memory-hard). Tras desbloquear, la clave de firma es{' '}
          <strong>no extraíble</strong>. La seguridad depende también de la fortaleza de tu
          contraseña y de que tu dispositivo no esté comprometido.
        </p>
      </Section>

      <Section title="Sobre las firmas">
        <p>
          Las firmas son <strong>PAdES</strong> y su validez legal depende de que tu certificado sea
          emitido por una Entidad de Certificación acreditada. En modo offline la firma es de perfil
          básico (B-B), <strong>sin sello de tiempo de un tercero</strong>.
        </p>
        <p>
          La función de validación es informativa (firmante, integridad, presencia de sello) y no
          comprueba revocación (OCSP/CRL) sin conexión. Te recomendamos verificar los documentos
          también en los validadores oficiales.
        </p>
      </Section>

      <Section title="Limitación de responsabilidad">
        <p>
          FirmaOK es una herramienta tecnológica y no constituye asesoría legal. No garantizamos la
          aceptación de un documento firmado en todos los contextos legales o institucionales. El
          uso del certificado y de los documentos firmados es responsabilidad del usuario.
        </p>
      </Section>

      <Section title="Responsable">
        <p>
          Operado por el titular de firmaok.com.ec. Para consultas sobre privacidad o ejercicio de
          derechos, contacta al responsable del sitio.
        </p>
      </Section>

      <p className="mt-2 text-[11px] text-slate-400">
        Última actualización: 2026. Este aviso resume el tratamiento de datos; consulta con un
        profesional legal para tu caso concreto.
      </p>
    </Modal>
  )
}
