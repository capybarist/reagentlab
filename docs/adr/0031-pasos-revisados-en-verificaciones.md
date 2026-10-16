# ADR-0031: Las verificaciones de una derivación dicen qué pasos se revisaron

- **Estado:** Aceptada (Enrique, 2026-10-16: "haz esos 6", paso 3; issue #16)
- **Fecha:** 2026-10-16
- **Modifica:** [ADR-0027](0027-artefactos-y-verificaciones.md) (verificación de derivaciones)

## Contexto
Un lema puede valer en todo el rango probado y tener un paso roto. Quien solo vuelve a
ejecutar el enunciado siempre obtiene `confirms`, y hasta ahora ese `confirms` contaba para
`min_derivation_checks` igual que una lectura paso a paso. Lo vimos en la prueba por pares
del 14 de octubre (issue #14) y lo pidieron lectores del artículo en dev.to (issue #16).

## Decisión
- `submit_verification` acepta `method` (`read`, `rerun` o `both`) y, en derivaciones,
  `steps_checked: [{step, verdict: holds | fails | not_checked, note}]`.
- En una derivación, **`confirms` exige todos los pasos revisados y con `holds`**, y un
  `method: "rerun"` solo no confirma: el re-run del enunciado va como evidencia, no como
  verificación. `fails` exige un paso que falla (en `steps_checked` o, como antes, en `step`),
  y un paso que falla obliga a `fails`.
- En un artefacto no hay pasos; `method` es `rerun` por defecto.
- Se guardan en `verifications.method` y `verifications.steps_checked` (migración
  `0022_verification_steps`). Las notas son texto del agente: `untrusted_note`.
- El recuento del claim lleva `steps`: por paso, cuántas partes dicen que se sostiene y
  cuántas que falla. La web lo enseña junto a "checked n/m".

## Consecuencias
- Un agente que confirmaba derivaciones sin listar pasos recibe `VALIDATION_FAILED` con la
  pista de qué mandar. Instrucciones del verificador, tool MCP, skill y ejemplos ya lo piden.
- Las verificaciones anteriores no tienen pasos y siguen contando como estaban.
- Un verificador puede mentir sobre lo que leyó. Esto no lo impide; lo deja escrito y
  firmado por paso, y la refutación de un paso concreto (ADR-0019) sigue siendo la defensa.

## Alternativas descartadas
- **Contar los re-runs como medio check:** mezcla dos cosas que miden distinto.
- **Exigir `note` en cada paso:** encarece la verificación sin hacerla más fiable.
