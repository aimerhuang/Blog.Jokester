ARG DOCKER_IMAGE_REGISTRY=docker.io

# ==================== Stage: Go backend runtime base ====================
# Frontend is pre-built by CI (.next/standalone), no in-Docker build needed
FROM ${DOCKER_IMAGE_REGISTRY}/library/alpine:latest AS backend-base

ARG VERSION=unknown
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
ARG TARGETARCH

LABEL org.opencontainers.image.title="Blog.Jokester" \
      org.opencontainers.image.description="Blog.Jokester - Self-hosted blog and content management system" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/anzhiyu-c/anheyu-app"

WORKDIR /anheyu

RUN apk update \
    && apk add --no-cache tzdata vips-tools ffmpeg libheif libraw-tools nodejs npm su-exec \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

RUN mkdir -p ./themes

ENV AN_SETTING_DEFAULT_ENABLE_FFMPEG_GENERATOR=true \
    AN_SETTING_DEFAULT_ENABLE_VIPS_GENERATOR=true \
    AN_SETTING_DEFAULT_ENABLE_LIBRAW_GENERATOR=true

ARG TARGETPLATFORM

RUN addgroup --system --gid 1001 anheyu && \
    adduser --system --uid 1001 anheyu

COPY blog-jokester ./blog-jokester
COPY default_files ./default-data
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./blog-jokester \
    && chmod +x ./entrypoint.sh \
    && chown -R anheyu:anheyu /anheyu

# ==================================================================
# Target: full (default) - Go backend + built-in Next.js frontend
#   Build: docker build --target full .
# ==================================================================
FROM backend-base AS full

COPY frontend/.next/standalone ./frontend/
COPY frontend/.next/static ./frontend/.next/static
COPY frontend/public ./frontend/public

EXPOSE 8091 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["./blog-jokester"]

# ==================================================================
# Target: api-only - Go backend only (frontend runs separately)
#   Build: docker build --target api-only .
# ==================================================================
FROM backend-base AS api-only

EXPOSE 8091 443

ENTRYPOINT ["./entrypoint.sh"]
CMD ["./blog-jokester"]

# ==================================================================
# Target: frontend - Next.js frontend only (standalone deployment)
#   Build: docker build --target frontend .
# ==================================================================
FROM ${DOCKER_IMAGE_REGISTRY}/library/node:20-alpine AS frontend

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --chown=nextjs:nodejs frontend/.next/standalone ./
COPY --chown=nextjs:nodejs frontend/.next/static ./.next/static
COPY --chown=nextjs:nodejs frontend/public ./public

USER nextjs

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
