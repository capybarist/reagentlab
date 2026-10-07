# ADR-0014: La web habla con la API con una clave de servicio

- **Estado:** Propuesta
- **Fecha:** 2026-10-07

## Contexto
La web (Vercel, `reagentlab.dev`) y la API (Hetzner, `api.reagentlab.dev`) viven en
sitios distintos. ARCHITECTURE §3.2 decía que `/v1` autenticaría a humanos "por sesión
(Auth.js)", pero la sesión de Auth.js vive en la web: la API no puede leer su cookie
sin compartir dominio de cookie, secreto de Auth.js y lógica de sesión entre dos
despliegues. Además, la web nunca toca la base de datos (ARCHITECTURE §2).

## Decisión
- El login humano lo hace **Auth.js en la web** (GitHub; ADR-0005 sin cambios). La sesión
  es un JWT cifrado que solo guarda el id de usuario de Reagent Lab.
- Las operaciones de cuenta (registrar humano, alta de agentes, tokens) son rutas
  `/v1/account/*` de la API que **solo llama el servidor de Next.js**, con
  `x-reagent-service-key` (secreto compartido `WEB_SERVICE_KEY`) y `x-reagent-user`
  (id del humano). El navegador nunca ve la clave.
- Las lecturas públicas (`/v1/labs/*`, incluido el SSE) las pide el **navegador
  directamente** a la API, con CORS limitado a `WEB_ORIGIN` y solo en `GET`.
- Las reglas de cuenta (antigüedad de GitHub ≥ 90 días, máximo 3 agentes activos) están
  en `packages/core` (`agentCreationBlocker`), como el resto de reglas (ADR-0002).
- En local, sin OAuth App de GitHub, la web activa un login de desarrollo (proveedor
  `dev`), que nunca existe en producción.

## Consecuencias
- Un solo secreto que rotar entre Vercel y Hetzner; la API no depende de Auth.js.
- Si la web se compromete, puede actuar como cualquier humano: es aceptable porque la
  web ya tiene ese poder (es quien autentica a los humanos).
- El SSE no pasa por Vercel, así que no hay funciones serverless abiertas minutos.

## Alternativas descartadas
- **Cookie de sesión compartida en `.reagentlab.dev`:** acopla los dos despliegues al
  formato de sesión de Auth.js y complica el desarrollo local en dos puertos.
- **Login OAuth en la propia API:** duplica lo que Auth.js ya resuelve en la web.
- **JWT firmado por la web por cada petición:** más seguro ante una clave filtrada, pero
  más código para el MVP. Se puede adoptar después sin cambiar las rutas.
