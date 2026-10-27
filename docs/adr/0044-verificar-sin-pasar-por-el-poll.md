# ADR-0044: Verificar sin pasar por el poll

- **Estado:** Aceptada (Enrique, 2026-10-27: "Adelante con todo")
- **Fecha:** 2026-10-27
- **Modifica:** [ADR-0008](0008-claims-maquina-de-estados.md) (máquina de estados),
  [ADR-0017](0017-polls-de-adopcion-y-de-disputa.md) (el poll como paso previo) y
  [ADR-0027](0027-artefactos-y-verificaciones.md) (verde solo desde adoptado)

## Contexto
A los 21 días de producción, 97 claims, 37 apoyados, 48 verificaciones enviadas y ningún claim
adoptado ni verificado. 12 claims tenían ya las 2 confirmaciones netas que pide el verde, pero
seguían en `supported`: `readyForGreen` solo miraba claims adoptados, y adoptar exigía resistir
dos refutaciones y ganar un poll con quórum (ADR-0017), cosas que no pasaban (ADR-0045, ADR-0046).
El ciclo ponía la comprobación objetiva, la prueba más fuerte que tiene el motor, detrás de dos
puertas subjetivas. La revisión completa está en el documento "Revisión del modelo de validación"
(2026-10-27).

## Decisión
- Un claim **apoyado o adoptado** pasa a `verified` cuando sus confirmaciones menos sus fallos, de
  partes distintas, llegan a `min_reproductions` (artefactos) o `min_derivation_checks`
  (derivaciones) **y no tiene ninguna refutación abierta** (pendiente, en dictamen provisional o
  en disputa). La adopción deja de ser requisito.
- Mientras alguien lo refuta, espera al dictamen. Una refutación rechazada que lo deja libre lo
  verifica en el acto (`settleRefutation` llama a `maybeVerify`); el worker (`run-polls`, cada
  minuto) repasa además los claims apoyados con confirmaciones (`verifyReadyClaims`), lo que
  verifica al desplegar los que ya cumplían.
- Un claim verificable (derivación, o cálculo con artefacto) **no va a poll de adopción**: se
  comprueba, no se vota. El poll queda para lo que no se puede comprobar (ADR-0046).
- Cada claim lleva `next`: qué le falta o qué lo bloquea, en una frase, en el contexto y en la web.
- Una refutación aceptada sobre un claim verificado sigue como en ADR-0008 (pide poll); ese poll
  sigue sin existir y queda pendiente.

## Consecuencias
- El orden del motor pasa a ser objetivo → adversarial → social: lo comprobable se comprueba, lo
  que no, se refuta, y solo lo que no admite ni lo uno ni lo otro se vota.
- Riesgo: dos verificadores que confirman a la ligera. Ya tienen que ser partes distintas, los
  canarios (ADR-0032) miden si cazan, y un `fails` posterior retira apoyo y reputación.
- `claimTransition` admite `verified` desde `supported`; `readyForGreen` recibe si hay
  refutación abierta. Tests nuevos en core y sobre PGlite.
