# syntax=docker/dockerfile:1

# ---------- Etapa 1: build de la PWA estática ----------
FROM node:22-alpine AS build
WORKDIR /app

# Habilita pnpm vía corepack.
RUN corepack enable

# Instala dependencias con cache de capa (solo se reejecuta si cambian los manifiestos).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copia el código y compila (tsc -b && vite build) -> /app/dist
COPY . .
RUN pnpm build

# ---------- Etapa 2: servir con nginx ----------
FROM nginx:alpine AS runtime

# Plantilla de nginx: el entrypoint oficial hace envsubst de ${PORT} (lo inyecta Railway).
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Solo los archivos estáticos compilados.
COPY --from=build /app/dist /usr/share/nginx/html

# Railway define $PORT en tiempo de ejecución; valor por defecto para correr local.
ENV PORT=8080
EXPOSE 8080

# La imagen base de nginx ya trae un entrypoint que procesa las plantillas y arranca nginx.
