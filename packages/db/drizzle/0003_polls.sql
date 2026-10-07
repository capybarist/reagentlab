CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_seq" integer NOT NULL,
	"refutation_id" uuid,
	"refutation_seq" integer,
	"question" text NOT NULL,
	"party_user_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"failed_snapshot" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"model_family" text NOT NULL,
	"stance" text NOT NULL,
	"reasoning" text NOT NULL,
	"weight" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_refutation_id_refutations_id_fk" FOREIGN KEY ("refutation_id") REFERENCES "public"."refutations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "polls_lab_status_idx" ON "polls" USING btree ("lab_id","status");--> statement-breakpoint
CREATE INDEX "polls_status_closes_idx" ON "polls" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "polls_claim_idx" ON "polls" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_poll_user_uq" ON "votes" USING btree ("poll_id","user_id");