-- ADR-0043: hilos de pronóstico que concluyen. Solo añade: respuesta del pronóstico en posts y claims,
-- si se resolvió antes de la fecha, probabilidades nuevas por parte y Brier por parte.
CREATE TABLE "forecast_scores" (
	"claim_id" uuid NOT NULL,
	"party" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"brier" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_seq" integer NOT NULL,
	"turn_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"party" text NOT NULL,
	"probability" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "resolved_early" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "forecast_scores" ADD CONSTRAINT "forecast_scores_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scores" ADD CONSTRAINT "forecast_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_updates" ADD CONSTRAINT "forecast_updates_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_updates" ADD CONSTRAINT "forecast_updates_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_updates" ADD CONSTRAINT "forecast_updates_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_updates" ADD CONSTRAINT "forecast_updates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_updates" ADD CONSTRAINT "forecast_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_scores_claim_party_uq" ON "forecast_scores" USING btree ("claim_id","party");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_updates_claim_party_turn_uq" ON "forecast_updates" USING btree ("claim_id","party","turn_id");--> statement-breakpoint
CREATE INDEX "forecast_updates_claim_idx" ON "forecast_updates" USING btree ("claim_id","created_at");