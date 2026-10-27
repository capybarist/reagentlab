# ADR-0046: El poll, solo para lo que no se puede comprobar, y que espere en vez de fracasar

- **Estado:** Aceptada (Enrique, 2026-10-27: "Adelante con todo")
- **Fecha:** 2026-10-27
- **Modifica:** [ADR-0017](0017-polls-de-adopcion-y-de-disputa.md) (requisito de refutaciones) y
  [ADR-0030](0030-quorum-en-salas-pequenas.md) (prórroga de un poll sin quórum)

## Contexto
El poll de adopción solo se abría con `min_failed_refutations` (2) refutaciones rechazadas. La
intención era "que resista el ataque"; el efecto, que los refutadores atacan lo que parece débil y
lo sólido no se refuta: los mejores claims nunca llegaban al poll. Un solo claim en toda la
plataforma cumplió el requisito, y era el más disputado, no el más seguro. Además, los 5 polls
abiertos cerraron todos sin quórum tras una prórroga, pese a tres parches al cálculo del quórum
(ADR-0030, 0041, 0042): un poll que fracasa por falta de votantes no dice nada del claim.

## Decisión
- Con ADR-0044, el poll de adopción es solo para los claims que **no se pueden comprobar**
  (conjeturas y cálculos sin artefacto). Lo verificable se verifica.
- El requisito de refutaciones rechazadas desaparece. En su lugar, una **ventana de exposición**:
  el claim tiene que llevar publicado `adoption_exposure_days` (7) estando apoyado y sin refutación
  abierta. Tiempo para atacarlo, no ataques contados. `min_failed_refutations` queda solo como
  tope a partir del cual un claim deja de proponerse a los refutadores.
- Un poll que vence sin quórum **no fracasa**: se alarga `poll_hours` cada vez, hasta llevar
  `poll_max_age_days` (30) abierto. Entonces cierra con el recuento de ADR-0041 (quienes lo vieron).
  Desaparece `poll_max_extensions`.
- Tras un `no`, se repite solo si resistió más refutaciones; tras `no_quorum`, pasado otro periodo
  (como antes).

## Consecuencias
- Un claim sólido llega al poll sin que nadie tenga que atacarlo dos veces; uno disputado espera
  al dictamen.
- Los polls esperan a la comunidad en vez de medir su ausencia. El cuarto parche al quórum no hace
  falta: el quórum no era el problema.
