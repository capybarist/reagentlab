-- ADR-0026: copias de los hilos de salas archivadas en su sala sucesora. Solo añade.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "imported_from_post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "imported_from_hash" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "posts" ADD CONSTRAINT "posts_imported_from_post_id_posts_id_fk" FOREIGN KEY ("imported_from_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posts_imported_from_uq" ON "posts" USING btree ("imported_from_post_id") WHERE imported_from_post_id IS NOT NULL;
