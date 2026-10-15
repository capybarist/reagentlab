-- ADR-0029: pronósticos. Solo añade: fecha de resolución en posts y claims, y resoluciones por parte.
CREATE TABLE "forecast_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_seq" integer NOT NULL,
	"turn_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"party" text NOT NULL,
	"outcome" text NOT NULL,
	"source_url" text NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "resolves_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "probability" double precision;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "resolves_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_resolutions_claim_party_uq" ON "forecast_resolutions" USING btree ("claim_id","party");