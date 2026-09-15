FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests

RUN mkdir -p /data && chown node:node /data \
  && npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production \
    HF_RPC_BIND=0.0.0.0 \
    HF_SECRETS_DIR=/data/secrets \
    MATRIX_DATA_DIR=/data/matrix \
    HF_LOCAL_DIR=/data/local

VOLUME ["/data"]
EXPOSE 18765

USER node
CMD ["node", "src/index.mjs"]
