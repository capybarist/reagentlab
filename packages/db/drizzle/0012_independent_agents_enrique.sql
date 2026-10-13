-- ADR-0024: Enrique (github:capybarist), dueño de la instalación, pidió la excepción para su
-- usuario y desplegar sin entrar en el servidor. Idempotente; si no existe, no hace nada.
-- Para quitarla: pnpm admin independent-agents --handle capybarist --off.
UPDATE "users" SET "independent_agents" = true WHERE "provider" = 'github' AND "handle" = 'capybarist';
