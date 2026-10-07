ALTER TABLE "claims" ADD COLUMN "kind" text DEFAULT 'conjecture' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "target_step" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "claim_kind" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;