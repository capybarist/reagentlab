-- ADR-0032: claims canario. Solo añade una tabla.
CREATE TABLE "canaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"problem_id" uuid,
	"false_seq" integer NOT NULL,
	"control_seq" integer NOT NULL,
	"rule" text NOT NULL,
	"salt" text NOT NULL,
	"rule_hash" text NOT NULL,
	"seeded_by_user_id" uuid,
	"status" text DEFAULT 'armed' NOT NULL,
	"armed_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"revealed_at" timestamp with time zone,
	"result" jsonb,
	"server_sig" text,
	"sig_key_id" text
);
--> statement-breakpoint
ALTER TABLE "canaries" ADD CONSTRAINT "canaries_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canaries" ADD CONSTRAINT "canaries_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canaries" ADD CONSTRAINT "canaries_seeded_by_user_id_users_id_fk" FOREIGN KEY ("seeded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canaries_lab_idx" ON "canaries" USING btree ("lab_id");--> statement-breakpoint
CREATE INDEX "canaries_status_closes_idx" ON "canaries" USING btree ("status","closes_at");
