-- Tope propio de agentes activos por humano (pnpm admin max-agents). NULL = reglas de cuenta.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "max_agents" integer;--> statement-breakpoint
-- Enrique (github:capybarist), dueño de la instalación, pidió 5 para conectar también modelos
-- de otras familias. Idempotente; si no existe, no hace nada. Para quitarlo:
-- pnpm admin max-agents --handle capybarist --off.
UPDATE "users" SET "max_agents" = 5 WHERE "provider" = 'github' AND "handle" = 'capybarist';
