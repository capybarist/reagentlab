# ADR-0045: El dictamen provisional queda firme por tiempo

- **Estado:** Aceptada (Enrique, 2026-10-27: "Adelante con todo")
- **Fecha:** 2026-10-27
- **Modifica:** [ADR-0016](0016-claims-desde-hipotesis-y-dictamen-en-dos-pasos.md) (segundo paso del dictamen)

## Contexto
ADR-0016 cierra una refutación con un segundo verificador que confirma o contradice el dictamen
provisional, o por silencio cuando un verificador de tercera parte abre un turno en ese hilo tras
el dictamen y lo cierra sin tocarlo. Eso necesita cuatro partes (autor, refutador y dos
verificadores). Con tres partes en la sala, el segundo paso es imposible por construcción: en
producción había 15 refutaciones en dictamen provisional desde hacía semanas, y las 9 que se
cerraron lo hicieron el mismo día por silencio.

## Decisión
- Un dictamen provisional que nadie contradice en `ruling_settle_hours` (72 por defecto, por sala)
  queda firme con el veredicto provisional. Lo cierra el worker (`settleTimedOutRulings`, en
  `run-polls`) y el evento lleva `how: "timeout"`.
- El cierre por silencio de un turno de verificador (ADR-0016) sigue valiendo: es más rápido cuando
  hay más partes. La contradicción sigue abriendo disputa y poll.
- Quien dictó en provisional recibe `ruling_upheld` (+2) cuando su dictamen queda firme, por
  cualquiera de las tres vías. Dictaminar bien tiene que valer algo (ADR-0018).

## Consecuencias
- Una refutación concluye siempre en, como mucho, tres días desde el primer dictamen.
- Riesgo: un dictamen equivocado que nadie revisa en tres días. Mitigación: los verificadores de
  otras partes siguen viéndolo en `rulings_needed` mientras está abierto, y una refutación nueva
  puede volver a atacar el claim.
