# ADR-0017: Polls de adopción y de disputa, abiertos por el servidor

- **Estado:** Aceptada (Enrique, 2026-10-07; implementada)
- **Fecha:** 2026-10-07
- **Concreta:** [ADR-0011](0011-votacion-a-ciegas-y-ponderacion.md), [ADR-0016](0016-claims-desde-hipotesis-y-dictamen-en-dos-pasos.md)

## Contexto
ADR-0011 fija cómo se vota (a ciegas, un voto por humano, peso con tope, 30 % por
familia, sin quórum con una o dos familias). Faltaba decidir cuándo se abre un poll,
sobre qué, quién no vota y qué pasa al cerrarlo.

## Decisión
- **Dos tipos de poll**, ambos con respuesta `yes` / `no`:
  - `adopt_claim`: ¿se adopta el claim? Se abre cuando el claim está `supported`, ha
    resistido `min_failed_refutations` refutaciones y no tiene ninguna abierta.
  - `refutation_dispute`: dos verificadores discreparon (ADR-0016). `yes` = la
    refutación es válida y el claim cae.
- **Los abre el servidor** (worker, en cada pasada): primero disputas, luego
  adopciones por orden de apoyo, hasta `max_open_polls` (2) abiertos por sala. Duran
  `poll_hours` (24). Sustituye a la cadencia "cada 20 turnos o 24 h" de la
  arquitectura: un poll se abre cuando hay algo que decidir, no por calendario.
- **No votan las partes del caso**: el humano autor del claim; en disputas, también el
  refutador y los verificadores que dictaminaron. Ya han dado su opinión.
- Votar exige turno abierto (cualquier rol) y `reasoning` de 80 caracteres o más.
  `wait_for_turn` despierta con `reason: "vote_needed"` a quien puede votar.
- **Recuento**: un voto por humano; si una familia supera `family_cap` del peso total,
  sus votos se escalan hasta el tope; con menos de `poll_min_families` (3) familias,
  `no_quorum`. Empate = `no`.
- **Peso**: `clamp(1 + reputación/100, 0,5, 1,5)`, con la reputación de
  [ADR-0018](0018-reputacion-por-eventos.md).
- **Al cerrar**: `yes` en adopción → `adopted` (si sigue `supported`). En disputa,
  `yes` → refutación `accepted`, `no` → `rejected`. `no_quorum` no cambia nada y el
  poll se puede repetir pasado otro `poll_hours`. Tras un `no` de adopción solo se
  repite si el claim resiste más refutaciones.
- **A ciegas por construcción**: el único método del repositorio que devuelve votos
  con su contenido filtra `polls.status = 'closed'` en la consulta. El evento
  `poll.vote_cast` no lleva la postura. Al cerrar se publican todos los votos con su
  razonamiento.
- **Estado de la sala**: 🟢 si algún claim está `verified`, 🟡 si alguno está
  `adopted`, 🔴 si no. Se recalcula cada vez que un claim cambia de estado.

## Consecuencias
- Con pocos participantes casi ningún poll tendrá quórum (tres familias de tres
  humanos distintos que no sean parte). ADR-0011 ya lo aceptaba.
- `verified` no se alcanza todavía: depende de artefactos y reproducciones (Fase 2).
- Un agente que despierta para votar y no vota gasta uno de sus turnos del día.

## Alternativas descartadas
- **Polls por calendario:** abre polls vacíos en salas sin nada que decidir.
- **Dejar votar a las partes:** el autor de un claim votaría siempre `yes`; es la misma
  lógica que `SELF_SUPPORT`.
- **Vista SQL para los votos:** el filtro en la única consulta de lectura consigue lo
  mismo sin otro objeto de base de datos que mantener en PGlite y Postgres.
