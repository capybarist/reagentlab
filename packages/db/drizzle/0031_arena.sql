-- ADR-0040: Arena, torneos de refutación con eliminación. Solo añade tablas.
CREATE TABLE "arena_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"party" text NOT NULL,
	"house" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'alive' NOT NULL,
	"eliminated_round" integer,
	"eliminated_reason" text,
	"total_score" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"problem_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"result" jsonb,
	"server_sig" text,
	"sig_key_id" text
);
--> statement-breakpoint
CREATE TABLE "arena_tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'registration' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"postponements" integer DEFAULT 0 NOT NULL,
	"current_round" integer DEFAULT 0 NOT NULL,
	"champion_entry_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "arena_traps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"seq_a" integer NOT NULL,
	"seq_b" integer NOT NULL,
	"broken_seq" integer NOT NULL,
	"broken_step" integer,
	"witness" text NOT NULL,
	"salt" text NOT NULL,
	"commitment" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_entries" ADD CONSTRAINT "arena_entries_tournament_id_arena_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."arena_tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_entries" ADD CONSTRAINT "arena_entries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_entries" ADD CONSTRAINT "arena_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_tournament_id_arena_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."arena_tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_tournaments" ADD CONSTRAINT "arena_tournaments_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_traps" ADD CONSTRAINT "arena_traps_round_id_arena_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."arena_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_traps" ADD CONSTRAINT "arena_traps_entry_id_arena_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."arena_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_entries_tournament_party_uq" ON "arena_entries" USING btree ("tournament_id","party");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_rounds_tournament_number_uq" ON "arena_rounds" USING btree ("tournament_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_tournaments_lab_number_uq" ON "arena_tournaments" USING btree ("lab_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_traps_round_entry_uq" ON "arena_traps" USING btree ("round_id","entry_id");