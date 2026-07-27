# WPPConnect Server — build customizado só pra habilitar secretKey via env var.
#
# Por quê existe este Dockerfile em vez de usar a imagem oficial direto:
# o config.ts oficial (wppconnect-team/wppconnect-server) tem TODOS os valores
# hardcoded no código-fonte, incluindo o secretKey padrão ("THISISMYSECURETOKEN"
# — público, todo mundo sabe). Não existe suporte a variável de ambiente pra
# isso na imagem oficial. Este Dockerfile clona o repo num commit fixo, troca
# só o config.ts (pra ler WPP_SECRET_KEY do ambiente) e builda do jeito deles,
# sem tocar em mais nada.
#
# Commit fixado: f09e2fedd904571d39afeca68e26f8fcc2f6d7dc (main, 2026-07-26)

FROM node:22.22.2-alpine AS base
WORKDIR /usr/src/wpp-server
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN apk update && \
    apk add --no-cache \
    git \
    vips \
    vips-dev \
    fftw-dev \
    gcc \
    g++ \
    make \
    libc6-compat \
    pkgconfig \
    python3 \
    && rm -rf /var/cache/apk/*

# Clona o commit fixado (não "main" solto — evita update surpresa em rebuild)
RUN git clone https://github.com/wppconnect-team/wppconnect-server.git . && \
    git checkout f09e2fedd904571d39afeca68e26f8fcc2f6d7dc

RUN corepack enable && \
    corepack prepare yarn@4.14.1 --activate

RUN yarn install --immutable

FROM base AS build
WORKDIR /usr/src/wpp-server

# Única mudança de verdade: nosso config.ts no lugar do deles (lê secretKey
# do ambiente em vez de hardcoded).
COPY config.ts ./src/config.ts

RUN yarn install
RUN yarn build

FROM build AS runtime
WORKDIR /usr/src/wpp-server/

RUN apk add --no-cache \
    chromium \
    vips \
    fftw

EXPOSE 21465
ENTRYPOINT ["node", "dist/server.js"]
