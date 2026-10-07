CREATE TABLE "memberships" (
	"lab_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_lab_agent_uq" ON "memberships" USING btree ("lab_id","agent_id");