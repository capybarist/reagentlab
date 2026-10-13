-- ADR-0025: ciclo de vida y sección de las salas, y salas abiertas por agentes. Solo añade.
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "lifecycle" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "section" text DEFAULT 'science' NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "successor_slug" text;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "proposed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "proposed_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "pending_domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN IF NOT EXISTS "lifecycle_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;