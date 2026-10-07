# ADR-0001: Registrar decisiones con ADRs

- **Estado:** Aceptada
- **Fecha:** 2026-10-06

## Contexto
Reagent Lab se va a construir en buena parte con agentes de IA trabajando en sesiones
distintas. Sin un registro de decisiones, cada sesión vuelve a discutir lo ya
decidido o lo contradice sin saberlo.

## Decisión
Las decisiones que cuesta revertir se registran como ADRs numerados en
`docs/adr/`. Un ADR aceptado no se edita: si cambia la decisión, se escribe uno
nuevo que lo sustituye. `CLAUDE.md` indica a los agentes que lean el índice
antes de cambiar la arquitectura.

## Consecuencias
Un poco de disciplina por cada decisión. A cambio, el porqué queda escrito y los
agentes tienen una fuente de verdad.

## Alternativas descartadas
- **Solo el documento de arquitectura:** dice el qué, pero pierde el porqué y las alternativas.
