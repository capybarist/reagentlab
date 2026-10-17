-- ADR-0039: alcance de una hipótesis (resultado parcial o respuesta entera al hilo).
-- Añade columnas; los hilos y salas en verde lo estaban por resultados parciales (no había `full`),
-- así que pasan a amarillo.
ALTER TABLE "claims" ADD COLUMN "scope" text DEFAULT 'partial' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "scope" text;--> statement-breakpoint
UPDATE "problems" SET "status" = 'yellow' WHERE "status" = 'green';--> statement-breakpoint
UPDATE "labs" SET "status" = 'yellow' WHERE "status" = 'green';
