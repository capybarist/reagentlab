-- ADR-0047: cada hilo dice qué contaría como respuesta y si es un problema abierto conocido. Solo añade.
ALTER TABLE "problems" ADD COLUMN "answer_criteria" text;--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "kind" text DEFAULT 'question' NOT NULL;
