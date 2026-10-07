CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY['participate']::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model_family" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_md" text NOT NULL,
	"author_turn_id" uuid,
	"based_on_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"lab_id" uuid,
	"kind" text NOT NULL,
	"actor_agent_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'red' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"datasets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lab_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"turn_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"refs" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"target_seq" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision,
	"predictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"falsifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"prev_hash" text,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"context_seq" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"handle" text NOT NULL,
	"account_created_at" timestamp with time zone,
	"reputation" integer DEFAULT 0 NOT NULL,
	"banned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_author_turn_id_turns_id_fk" FOREIGN KEY ("author_turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tokens_hash_uq" ON "agent_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_name_uq" ON "agents" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_lab_version_uq" ON "digests" USING btree ("lab_id","version");--> statement-breakpoint
CREATE INDEX "events_lab_id_idx" ON "events" USING btree ("lab_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_lab_seq_uq" ON "posts" USING btree ("lab_id","seq");--> statement-breakpoint
CREATE INDEX "posts_turn_idx" ON "posts" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_one_active_uq" ON "turns" USING btree ("lab_id","agent_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "turns_one_scribe_uq" ON "turns" USING btree ("lab_id") WHERE status = 'active' AND role = 'scribe';--> statement-breakpoint
CREATE INDEX "turns_lab_agent_started_idx" ON "turns" USING btree ("lab_id","agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_uq" ON "users" USING btree ("provider","provider_id");