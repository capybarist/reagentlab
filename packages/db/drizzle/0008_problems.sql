CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"source_url" text,
	"review" text DEFAULT 'active' NOT NULL,
	"status" text DEFAULT 'red' NOT NULL,
	"proposed_by_user_id" uuid,
	"proposed_by_agent_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "digests_lab_version_uq";--> statement-breakpoint
DROP INDEX "turns_one_scribe_uq";--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "digests" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "problem_id" uuid;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "problems_lab_slug_uq" ON "problems" USING btree ("lab_id","slug");--> statement-breakpoint
CREATE INDEX "problems_lab_review_idx" ON "problems" USING btree ("lab_id","review");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digests_lab_charter_uq" ON "digests" USING btree ("lab_id","version") WHERE problem_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "digests_problem_version_uq" ON "digests" USING btree ("problem_id","version") WHERE problem_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_problem_seq_idx" ON "posts" USING btree ("problem_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_one_scribe_per_problem_uq" ON "turns" USING btree ("problem_id") WHERE status = 'active' AND role = 'scribe';--> statement-breakpoint
-- Datos (ADR-0020): cada sala con contenido anterior recibe un problema `general` que lo
-- agrupa todo, con su propio digest v0 (copia de la ficha de la sala). No se borra nada.
INSERT INTO "problems" ("lab_id", "slug", "title", "statement", "review", "status")
SELECT l."id", 'general', l."title",
       'Everything posted in this lab before labs were split into problems (ADR-0020). ' || l."description",
       'active', l."status"
FROM "labs" l
WHERE EXISTS (SELECT 1 FROM "posts" p WHERE p."lab_id" = l."id")
   OR EXISTS (SELECT 1 FROM "turns" t WHERE t."lab_id" = l."id")
   OR EXISTS (SELECT 1 FROM "digests" d WHERE d."lab_id" = l."id" AND d."version" > 0);--> statement-breakpoint
UPDATE "posts" x SET "problem_id" = p."id" FROM "problems" p WHERE p."lab_id" = x."lab_id" AND p."slug" = 'general' AND x."problem_id" IS NULL;--> statement-breakpoint
UPDATE "turns" x SET "problem_id" = p."id" FROM "problems" p WHERE p."lab_id" = x."lab_id" AND p."slug" = 'general' AND x."problem_id" IS NULL;--> statement-breakpoint
UPDATE "claims" x SET "problem_id" = p."id" FROM "problems" p WHERE p."lab_id" = x."lab_id" AND p."slug" = 'general' AND x."problem_id" IS NULL;--> statement-breakpoint
UPDATE "polls" x SET "problem_id" = p."id" FROM "problems" p WHERE p."lab_id" = x."lab_id" AND p."slug" = 'general' AND x."problem_id" IS NULL;--> statement-breakpoint
UPDATE "digests" x SET "problem_id" = p."id" FROM "problems" p WHERE p."lab_id" = x."lab_id" AND p."slug" = 'general' AND x."problem_id" IS NULL AND x."version" > 0;--> statement-breakpoint
INSERT INTO "digests" ("lab_id", "problem_id", "version", "content_md", "based_on_seq")
SELECT d."lab_id", p."id", 0, d."content_md", 0
FROM "digests" d JOIN "problems" p ON p."lab_id" = d."lab_id" AND p."slug" = 'general'
WHERE d."problem_id" IS NULL AND d."version" = 0;
