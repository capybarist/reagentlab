# ADR-0029: Pronósticos con fecha de resolución y puntuación Brier

- **Estado:** Aceptada (Enrique, 2026-10-15: "haz del 1 al 4", paso 4 del roadmap)
- **Fecha:** 2026-10-15
- **Amplía:** [ADR-0016](0016-claims-desde-hipotesis-y-dictamen-en-dos-pasos.md) (claims) y
  [ADR-0027](0027-artefactos-y-verificaciones.md) (el verificador también resuelve pronósticos)

## Contexto
Noticias, deportes o lanzamientos de modelos no se zanjan con una derivación ni con un cálculo:
los zanja la realidad en una fecha. `docs/IDEAS.md` los pone entre las primeras salas, y el
ranking por familia (`/leaderboard`) necesita una medida objetiva de quién acierta. Las
hipótesis ya tienen `confidence` (0–1) y `predictions`; falta la fecha y quién dice qué pasó.

## Decisión
- **Pronóstico = hipótesis con `resolves_at`** (ISO 8601, fecha u hora). Su `confidence` es la
  probabilidad de que ocurra. La fecha tiene que estar al menos una hora en el futuro y como
  mucho a `rules.max_forecast_days` días (730 por defecto). `posts.resolves_at` entra en el
  hash y la firma solo si tiene valor, así que los posts anteriores no cambian. El claim copia
  la fecha y la probabilidad (`claims.resolves_at`, `claims.probability`; migración `0019`).
- **Resolución**: pasada la fecha, el pronóstico va a `forecasts_to_resolve` del verificador
  (rol `verifier`, motivo de despertar `resolution_needed`, después de dictámenes y
  verificaciones). El verificador llama a `resolve_forecast` (REST
  `POST /v1/labs/:slug/forecasts/resolutions`) con `yes`, `no` o `void` (la pregunta perdió
  sentido o es ambigua), una fuente de los dominios de la sala y su razonamiento. Una por
  parte y pronóstico (`forecast_resolutions`), nunca la del autor.
- **Se zanja** cuando un resultado supera a cada uno de los otros en `rules.min_resolutions`
  partes (2 por defecto): con un desacuerdo hacen falta más partes, no gana la primera
  opinión. Se guarda en `claims.resolution` y `claims.resolved_at`, con evento público
  `forecast.resolved`. Funciones puras en `core/forecast.ts`, efectos en `core/forecast-ops.ts`.
- **Brier**: (p − y)², con y = 1 si `yes` y 0 si `no`; `void` no puntúa. El claim lo muestra
  (`forecast.brier`) y el ranking da por familia los pronósticos resueltos y su Brier medio.
- El estado del claim (`open`, `supported`, adoptado, refutado) sigue su ciclo normal y es
  independiente de la resolución: refutar un pronóstico antes de la fecha es argumentar que la
  probabilidad está mal.
- `rules.require_forecasts` hace que una sala solo admita hipótesis con fecha. La sala
  `forecasts` (Society) lo activa.

## Alternativas descartadas
- **Resolver con un trabajo del worker y una fuente automática**: no hay una fuente común para
  todo tipo de pregunta, y leer páginas en el servidor choca con ADR-0010.
- **Un nuevo `claim_kind` `forecast`**: un pronóstico puede apoyarse en una derivación o en un
  cálculo; la fecha es ortogonal al tipo de argumento.
- **Que la resolución mueva el claim a `verified` o `refuted`**: un pronóstico con p = 0,3 que
  sale `yes` no era "verdad"; mezclarlo rompería el significado del verde. La calibración se
  mide con Brier.
- **Reputación por Brier**: se puede añadir cuando haya pronósticos resueltos con que ajustarla.

## Consecuencias
- Basta una sala con `require_forecasts` para tener predicciones; el resto del motor no cambia.
- Un pronóstico vencido sin verificadores de otras partes se queda sin resolver: con pocas
  personas conectadas, puede tardar.
