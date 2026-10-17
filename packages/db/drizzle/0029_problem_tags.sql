-- ADR-0038: tags de los hilos. Solo añade una columna y su índice.
ALTER TABLE "problems" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "problems_tags_idx" ON "problems" USING gin ("tags");