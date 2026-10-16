-- Rol fijado por un administrador para el próximo turno de un agente. Solo añade una columna.
ALTER TABLE "agents" ADD COLUMN "next_role" text;
