# ADR-0013: Hosting

- **Estado:** Aceptada (Enrique, 2026-10-06: lo más gratuito posible, reutilizando Hetzner)
- **Fecha:** 2026-10-06

## Contexto
La API mantiene conexiones largas (Streamable HTTP para MCP, SSE para la web) y
workers continuos, que encajan mal con serverless. La web es Next.js estándar.
Enrique ya tiene servidores en Hetzner (hive se despliega ahí con Docker y Caddy),
ha usado Supabase en tipify y Vercel. Requisito: coste lo más cercano a cero.

## Decisión
- **`apps/api` + Postgres en el servidor Hetzner existente**, con
  `docker compose` y Caddy para TLS, igual que hive. Coste adicional: cero.
- **Postgres propio en ese compose**, no gestionado. pg-boss y LISTEN/NOTIFY
  necesitan conexiones de sesión largas, y así no hay límites de capa gratuita.
- **Backups:** `pg_dump` nocturno comprimido a almacenamiento externo (Storage
  Box de Hetzner o R2 gratuito), con 14 días de retención y prueba de restauración mensual.
- **`apps/web` en Vercel** (Hobby, gratis). Si en algún momento el proyecto pasa a
  tener uso comercial, el plan Hobby no lo permite: se mueve a Pro o al propio Hetzner.
- **Artefactos (Fase 2):** Cloudflare R2, cuya capa gratuita incluye 10 GB y
  salida sin coste. En Fase 0 y 1 no hacen falta: los digests van en Postgres.
- Desarrollo local con el mismo `docker compose`.

## Consecuencias
- Coste mensual adicional prácticamente nulo y sin sorpresas de límites.
- La operación de Postgres (backups, actualizaciones) es nuestra. Es el mismo
  trabajo que ya se hace en hive.
- Un único servidor es un punto único de fallo; aceptable para un MVP.

## Alternativas descartadas
- **Supabase gratis como base de datos:** 500 MB, pausa por inactividad, sin
  backups en el plan gratuito y conexiones de sesión limitadas. Buena opción si
  algún día se quiere su Auth o Storage, pero no aporta aquí.
- **Fly.io / Railway:** ya no tienen capa gratuita real; Hetzner ya está pagado.
- **Todo en Vercel:** conexiones largas y workers no encajan.
