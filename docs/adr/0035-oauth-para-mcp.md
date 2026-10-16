# ADR-0035: OAuth para conectar clientes MCP

- Estado: Aceptada
- Fecha: 2026-10-16

## Contexto

Hasta ahora un agente se conecta pegando un token `rl_ag_…` en la configuración MCP. Los
clientes con conectores remotos (Claude, ChatGPT, IDEs) piden OAuth 2.1 según la especificación
de autorización de MCP: metadatos del recurso protegido, servidor de autorización, registro
dinámico y PKCE. Sin eso, "trae tu agente" exige copiar secretos a mano.

## Decisión

1. **La API es el servidor de autorización** y el de recursos (`/mcp`). Publica
   `/.well-known/oauth-protected-resource` (RFC 9728) y `/.well-known/oauth-authorization-server`
   (RFC 8414). `/mcp` sin token responde 401 con `WWW-Authenticate: Bearer resource_metadata="…"`.
2. **Registro dinámico** (RFC 7591) en `/oauth/register`: solo clientes públicos
   (`token_endpoint_auth_method: none`), con `redirect_uris` https o http a localhost (RFC 8252).
3. **Autorización**: `/oauth/authorize` comprueba el cliente y que el `redirect_uri` es suyo (si
   no, no redirige a ningún sitio) y manda al humano a la web, `/oauth/authorize`. Allí inicia
   sesión si hace falta, ve el nombre del cliente y el sitio al que volverá, y elige con cuál de sus
   agentes activos se conecta. Los agentes se crean en la cuenta, con sus reglas (ADR-0022, 0024).
4. **Código**: de un solo uso, 10 minutos, ligado a cliente, agente, `redirect_uri` y
   `code_challenge` (solo S256). La respuesta lleva `iss` (RFC 9207).
5. **Token**: `/oauth/token` (`authorization_code` con `code_verifier`) devuelve un **token de
   agente normal**. Cuenta en el tope de 3 tokens por agente, se ve y se revoca en la cuenta, y
   vale igual en REST y MCP. No hay `refresh_token` ni caducidad: como los tokens pegados a mano.
6. **Configuración**: `PUBLIC_API_URL` (emisor) y `WEB_URL` (consentimiento). La web acepta
   `next` en `/signin`, solo con rutas propias.

## Consecuencias

- Un cliente MCP se conecta con la URL `https://api.reagentlab.capybaralabs.tech/mcp` y un clic en
  la web; el token manual sigue funcionando.
- Revocar un token desde la cuenta corta ese cliente; tendrá que volver a autorizarse.
- Pendiente: caducidad con `refresh_token` y scopes de solo lectura, si hacen falta.
