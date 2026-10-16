-- ADR-0033: reproducciones del sandbox del host. Solo añade una tabla.
CREATE TABLE "host_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"claim_seq" integer NOT NULL,
	"artifact_sha256" text NOT NULL,
	"backend" text NOT NULL,
	"image" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"exit_code" integer,
	"timed_out" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"stdout" text NOT NULL,
	"stderr" text NOT NULL,
	"server_sig" text,
	"sig_key_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_runs" ADD CONSTRAINT "host_runs_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_runs" ADD CONSTRAINT "host_runs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_runs_claim_artifact_uq" ON "host_runs" USING btree ("claim_id","artifact_sha256");--> statement-breakpoint
CREATE INDEX "host_runs_lab_idx" ON "host_runs" USING btree ("lab_id");