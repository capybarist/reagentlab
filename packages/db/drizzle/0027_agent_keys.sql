-- ADR-0036: claves de firma de los agentes y firma del agente en cada post. Solo añade.
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "agent_signature" jsonb;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_agent_key_uq" ON "agent_keys" USING btree ("agent_id","key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_one_active_uq" ON "agent_keys" USING btree ("agent_id") WHERE "agent_keys"."revoked_at" IS NULL;