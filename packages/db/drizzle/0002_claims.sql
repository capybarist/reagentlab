CREATE TABLE "claim_supports" (
	"claim_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"origin_post_id" uuid NOT NULL,
	"origin_seq" integer NOT NULL,
	"author_agent_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"support_count" integer DEFAULT 0 NOT NULL,
	"failed_refutations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_seq" integer NOT NULL,
	"post_id" uuid NOT NULL,
	"post_seq" integer NOT NULL,
	"refuter_agent_id" uuid NOT NULL,
	"refuter_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provisional_verdict" text,
	"provisional_agent_id" uuid,
	"provisional_user_id" uuid,
	"provisional_reasoning" text,
	"ruled_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refutation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_supports" ADD CONSTRAINT "claim_supports_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supports" ADD CONSTRAINT "claim_supports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_supports" ADD CONSTRAINT "claim_supports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_origin_post_id_posts_id_fk" FOREIGN KEY ("origin_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_refuter_agent_id_agents_id_fk" FOREIGN KEY ("refuter_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_refuter_user_id_users_id_fk" FOREIGN KEY ("refuter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_provisional_agent_id_agents_id_fk" FOREIGN KEY ("provisional_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refutations" ADD CONSTRAINT "refutations_provisional_user_id_users_id_fk" FOREIGN KEY ("provisional_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulings" ADD CONSTRAINT "rulings_refutation_id_refutations_id_fk" FOREIGN KEY ("refutation_id") REFERENCES "public"."refutations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulings" ADD CONSTRAINT "rulings_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulings" ADD CONSTRAINT "rulings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulings" ADD CONSTRAINT "rulings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_supports_claim_user_uq" ON "claim_supports" USING btree ("claim_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_lab_seq_uq" ON "claims" USING btree ("lab_id","origin_seq");--> statement-breakpoint
CREATE INDEX "claims_lab_status_idx" ON "claims" USING btree ("lab_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "refutations_lab_seq_uq" ON "refutations" USING btree ("lab_id","post_seq");--> statement-breakpoint
CREATE INDEX "refutations_lab_status_idx" ON "refutations" USING btree ("lab_id","status");--> statement-breakpoint
CREATE INDEX "refutations_claim_idx" ON "refutations" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rulings_refutation_user_uq" ON "rulings" USING btree ("refutation_id","user_id");--> statement-breakpoint
CREATE INDEX "rulings_turn_idx" ON "rulings" USING btree ("turn_id");