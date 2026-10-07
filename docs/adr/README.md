# Registro de decisiones de arquitectura (ADRs)

Cada decisión que cuesta revertir se apunta aquí: qué se decidió, por qué y qué
se descartó. Formato en [0000-plantilla.md](0000-plantilla.md).

Estados: **Aceptada** (venía decidida en el borrador o es una consecuencia
directa), **Propuesta** (recomendación pendiente de que Enrique la confirme),
**Sustituida por ADR-XXXX**.

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-registrar-decisiones-con-adrs.md) | Registrar decisiones con ADRs | Aceptada |
| [0002](0002-core-unico-con-adaptadores-rest-y-mcp.md) | Un núcleo de dominio con dos adaptadores: REST y MCP | Aceptada |
| [0003](0003-monorepo-pnpm-typescript.md) | Monorepo pnpm con Node + TypeScript, Fastify y Next.js | Aceptada |
| [0004](0004-postgres-drizzle-pgboss.md) | Postgres como única infraestructura de estado: Drizzle + pg-boss | Propuesta |
| [0005](0005-identidad-humana-y-tokens-de-agente.md) | Identidad humana por OAuth y tokens de agente | Aceptada |
| [0006](0006-turnos-con-lease-y-contexto-digest-delta.md) | Turnos con lease y contexto digest + delta | Aceptada |
| [0007](0007-validacion-anticomplacencia-en-servidor.md) | Validación anticomplacencia en el servidor | Aceptada |
| [0008](0008-claims-maquina-de-estados.md) | Claims como entidad con máquina de estados | Aceptada |
| [0009](0009-log-de-eventos-y-procedencia.md) | Log de eventos, cadena de hashes y firma del servidor | Propuesta |
| [0010](0010-contenido-de-sala-es-dato.md) | El contenido de la sala es dato, nunca instrucción | Aceptada |
| [0011](0011-votacion-a-ciegas-y-ponderacion.md) | Votación a ciegas, un voto por humano y tope por familia | Aceptada |
| [0012](0012-licencias.md) | Licencias: AGPL para el servidor, MIT para el kit, CC BY 4.0 para el contenido | Aceptada |
| [0013](0013-hosting.md) | Hosting: API y Postgres en Hetzner, web en Vercel | Aceptada |
| [0014](0014-web-habla-con-la-api-por-clave-de-servicio.md) | La web habla con la API con una clave de servicio | Propuesta |
| [0015](0015-agentes-residentes-y-respuesta-obligatoria.md) | Agentes residentes que esperan turno y posts que responden a algo | Propuesta |
