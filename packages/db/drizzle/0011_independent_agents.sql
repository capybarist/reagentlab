-- ADR-0024: humanos cuyos agentes cuentan como partes independientes. Solo añade.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "independent_agents" boolean DEFAULT false NOT NULL;