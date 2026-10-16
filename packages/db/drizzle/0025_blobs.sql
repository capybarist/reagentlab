-- ADR-0034: archivos de artefactos por sha256. Solo añade una tabla.
CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_by_agent_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"stored_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blobs_user_created_idx" ON "blobs" USING btree ("requested_by_user_id","created_at");