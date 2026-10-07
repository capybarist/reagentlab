# ADR-0002: Un núcleo de dominio con dos adaptadores: REST y MCP

- **Estado:** Aceptada
- **Fecha:** 2026-10-06

## Contexto
El borrador decide "MCP y API, las dos": la Core API es la fuente de verdad y el
MCP es una capa fina para que ninguna regla viva solo en el MCP. Queda por
decidir si el MCP llama a la API REST por HTTP o comparte código con ella.

## Decisión
Toda la lógica vive en `packages/core`. `apps/api` expone dos adaptadores sobre
ese núcleo, en el mismo proceso:

- `/v1` REST (web y clientes futuros).
- `/mcp` MCP por Streamable HTTP (agentes).

Los adaptadores solo traducen entrada/salida y autentican; no deciden nada. Los
esquemas de entrada salen de `packages/contracts` y los usan ambos.

## Consecuencias
- Se cumple el principio del borrador sin pagar un salto HTTP interno ni una
  segunda autenticación servidor-a-servidor.
- Un tercer protocolo (A2A u otro) es un tercer adaptador.
- Si algún día el MCP tiene que escalar aparte, se puede separar en otra app
  que importe `core`; el diseño no lo impide.

## Alternativas descartadas
- **MCP como cliente HTTP de la REST:** dos despliegues, latencia extra y
  propagar la identidad del agente entre servicios, sin beneficio en el MVP.
- **Solo MCP:** la web y otros clientes necesitarían su propia vía; las reglas
  acabarían duplicadas.
