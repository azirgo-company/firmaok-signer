# FirmaOK Signer

PWA **100% offline** para **firmar** y **validar** documentos PDF en Ecuador. El certificado
(.p12), su clave privada y los documentos **nunca salen del dispositivo**. Firma **PAdES**
(compatible con FirmaEC / validadores oficiales). Cumple **LOPDA** (datos cifrados, locales,
con derecho de supresión).

## Características

- **Firma PAdES-B visible** (recuadro estilo FirmaEC, posición arrastrable, multipágina).
- **Validación offline** de firmas: firmante, CA emisora, fecha, integridad, cobertura.
- **Certificado persistente y cifrado**: se importa una vez; se desbloquea con **biometría
  (WebAuthn PRF)** o **PIN**. La contraseña del .p12 no se vuelve a pedir.
- **Clave de firma no extraíble** (WebCrypto): inmune a exfiltración por XSS una vez importada.
- **Offline real**: service worker (Workbox) precachea todo, incluido el worker de pdf.js.

## Stack

Vite + React + TypeScript · Tailwind v4 · vite-plugin-pwa · node-forge (lee .p12) ·
PKI.js + WebCrypto (CMS PAdES) · pdf-lib + @signpdf (placeholder/ByteRange) · pdf.js (render +
extracción) · idb (IndexedDB) · WebAuthn PRF (biometría) · react-rnd (recuadro de firma).

## Arquitectura (`src/modules`)

| Módulo | Responsabilidad |
|---|---|
| `cert-vault` | Parseo .p12, clave no extraíble, cifrado AES-GCM (PRF/PIN), IndexedDB, unlock/wipe |
| `crypto-core` | CMS SignedData PAdES (content-type, message-digest, signing-time, signing-cert-v2) |
| `pdf-signer` | Apariencia visible + placeholder + ByteRange + firma con WebCrypto |
| `pdf-validator` | Extracción de firmas (Uint8Array, sin Buffer) + verificación con PKI.js |
| `pdf-viewer` | Render con pdf.js + recuadro arrastrable → coordenadas PDF |
| `privacy-lopda` | Consentimiento informado, aviso de privacidad |

## Comandos

```bash
pnpm dev       # desarrollo
pnpm build     # build de producción (genera el service worker PWA)
pnpm preview   # sirve el build
npx vitest run # tests (10/10)
```

## Despliegue (Railway / Docker)

La app es una PWA 100% estática. El `Dockerfile` hace build con Node y la sirve con nginx,
escuchando en el `$PORT` que Railway inyecta. La config de nginx (`nginx/default.conf.template`)
incluye fallback SPA, no-cache del service worker e index, y cache inmutable de los assets.

En Railway: **New Project → Deploy from Repo**. Railway detecta el `Dockerfile` automáticamente;
no requiere configuración extra (inyecta `PORT`).

Probar la imagen localmente:

```bash
docker build -t firmaok-signer .
docker run -p 8080:8080 firmaok-signer   # http://localhost:8080
```

## Estado y verificación pendiente

Núcleo verificado por tests automáticos (parseo p12 → clave no extraíble → CMS PAdES →
firma en PDF → validación con detección de manipulación). **Falta verificación manual E2E**
contra validadores oficiales antes de producción:

- [ ] Firmar un PDF y validarlo en **Adobe Acrobat Reader**, **app.firmar.ec/verificar** y
      **minka.gob.ec** (perfil B-B esperado, sin sello de tiempo).
- [ ] Leer en nuestro validador un PDF firmado por FirmaEC oficial.
- [ ] Probar con certificados reales de AC ecuatorianas (Security Data, BCE, Uanataca, etc.).

## Limitaciones conocidas

- **Multifirma**: se puede añadir una segunda firma, pero conservar la validez criptográfica de
  firmas previas requiere **actualización incremental** del PDF (pendiente de endurecer; hoy
  `pdf-lib` reescribe el documento al guardar).
- **Offline estricto**: PAdES-B sin sello de tiempo (TSA) ni revocación (OCSP/CRL).
- **Validación de cadena**: falta empaquetar las raíces de las AC ecuatorianas en `public/ac-roots`
  para validar la cadena de confianza offline (hoy se reporta firmante e integridad).
- **Solo RSA** en esta versión (mayoría de certificados ecuatorianos).
