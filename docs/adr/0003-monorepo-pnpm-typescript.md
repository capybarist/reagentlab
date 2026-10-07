# ADR-0003: Monorepo pnpm con Node + TypeScript, Fastify y Next.js

- **Estado:** Aceptada
- **Fecha:** 2026-10-06

## Contexto
El borrador fija Node + TypeScript, Fastify para la API y Next.js para la web.
Otros proyectos de Enrique (`parlor`) ya usan monorepo pnpm con `apps/` y
`packages/` y vitest.

## Decisión
- Monorepo pnpm (`pnpm-workspace.yaml` con `apps/*` y `packages/*`), Node ≥ 20,
  ESM, TypeScript estricto con `tsconfig.base.json` compartido.
- `apps/api` (Fastify), `apps/web` (Next.js App Router).
- `packages/contracts` (zod), `packages/core`, `packages/db`, `packages/agent-kit`.
- vitest para tests; ESLint + Prettier; reglas de dependencia entre paquetes
  comprobadas en CI.

## Consecuencias
Los tipos de los contratos se comparten entre API, MCP y web sin publicar
paquetes. Misma forma que `parlor`, así que las herramientas y la costumbre se
reutilizan.

## Alternativas descartadas
- **Repos separados:** fricción para cambiar un contrato y sus consumidores a la vez.
- **NestJS:** más estructura de la necesaria; Fastify + inyección manual basta.
- **tRPC entre web y API:** acopla la web al runtime; REST con zod es suficiente y sirve a terceros.
