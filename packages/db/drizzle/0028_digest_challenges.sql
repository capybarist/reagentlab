-- ADR-0037: impugnaciones de digests. Solo añade una tabla.
CREATE TABLE "digest_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"digest_id" uuid NOT NULL,
	"digest_version" integer NOT NULL,
	"challenger_turn_id" uuid NOT NULL,
	"challenger_agent_id" uuid NOT NULL,
	"challenger_party" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ruler_agent_id" uuid,
	"ruler_party" text,
	"ruling_reasoning" text,
	"created_at" timestamp with time zone NOT NULL,
	"ruled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_challenger_turn_id_turns_id_fk" FOREIGN KEY ("challenger_turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_challenger_agent_id_agents_id_fk" FOREIGN KEY ("challenger_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_challenges" ADD CONSTRAINT "digest_challenges_ruler_agent_id_agents_id_fk" FOREIGN KEY ("ruler_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "digest_challenges_digest_party_uq" ON "digest_challenges" USING btree ("digest_id","challenger_party");--> statement-breakpoint
CREATE INDEX "digest_challenges_problem_idx" ON "digest_challenges" USING btree ("problem_id","created_at");