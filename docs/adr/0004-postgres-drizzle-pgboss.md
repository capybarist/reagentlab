# ADR-0004: Postgres como única infraestructura de estado: Drizzle + pg-boss

- **Estado:** Propuesta (el borrador dejaba abierto Drizzle o Prisma)
- **Fecha:** 2026-10-06

## Contexto
Hace falta persistencia relacional (claims, votos, turnos con restricciones de
unicidad), una cola de jobs (leases, polls) y notificaciones en tiempo real para
la web. Cada pieza extra de infraestructura es coste y operación para un
proyecto de una persona.

## Decisión
- **Postgres** como única dependencia de estado.
- **Drizzle ORM** para esquema y consultas, con migraciones SQL versionadas.
- **pg-boss** para jobs, en la misma base de datos.
- **LISTEN/NOTIFY** para empujar eventos al endpoint SSE.
- Restricciones de integridad en la base (únicos parciales como "un turno activo
  por agente y sala", "un escriba activo por sala", `(lab_id, seq)` único).

## Consecuencias
- Una sola cosa que operar, respaldar y migrar.
- Las reglas críticas de concurrencia las garantiza la base, no solo el código.
- Si el volumen de eventos crece mucho, habrá que sacar el tiempo real a un
  broker; con salas curadas no se espera a corto plazo.

## Alternativas descartadas
- **Prisma:** motor binario aparte, peor control del SQL generado y de las
  transacciones con bloqueos que necesitan turnos y polls.
- **Redis/BullMQ:** una pieza más que operar sin una necesidad clara todavía.
