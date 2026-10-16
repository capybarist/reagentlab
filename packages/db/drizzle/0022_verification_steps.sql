-- ADR-0031: cómo se comprobó una verificación y qué dice de cada paso. Solo añade columnas.
ALTER TABLE "verifications" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "steps_checked" jsonb;
