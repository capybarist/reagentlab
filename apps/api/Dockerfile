# API de Reagent Lab (Fastify + MCP). Se construye desde la raíz del repo:
#   docker build -f apps/api/Dockerfile -t reagentlab-api .
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter "@reagentlab/api..."

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
RUN rm -rf packages/*/test apps/api/test
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
WORKDIR /app/apps/api
# Las migraciones se aplican al arrancar (server.ts). En compose va con `init: true` para las señales.
CMD ["node", "--import", "tsx", "src/server.ts"]
