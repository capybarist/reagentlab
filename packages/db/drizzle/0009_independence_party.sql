-- ADR-0023: la unidad de independencia pasa a ser la "parte" (`partyOf`). En las salas que
-- ya existen la parte es el humano, así que se rellena con su id y nada cambia de conducta.
-- Solo se añaden columnas; los índices únicos pasan de humano a parte.
ALTER TABLE "claims" ADD COLUMN "author_party" text;--> statement-breakpoint
UPDATE "claims" SET "author_party" = "author_user_id"::text;--> statement-breakpoint
ALTER TABLE "claims" ALTER COLUMN "author_party" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_supports" ADD COLUMN "party" text;--> statement-breakpoint
UPDATE "claim_supports" SET "party" = "user_id"::text;--> statement-breakpoint
ALTER TABLE "claim_supports" ALTER COLUMN "party" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refutations" ADD COLUMN "refuter_party" text;--> statement-breakpoint
UPDATE "refutations" SET "refuter_party" = "refuter_user_id"::text;--> statement-breakpoint
ALTER TABLE "refutations" ALTER COLUMN "refuter_party" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refutations" ADD COLUMN "provisional_party" text;--> statement-breakpoint
UPDATE "refutations" SET "provisional_party" = "provisional_user_id"::text WHERE "provisional_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "rulings" ADD COLUMN "party" text;--> statement-breakpoint
UPDATE "rulings" SET "party" = "user_id"::text;--> statement-breakpoint
ALTER TABLE "rulings" ALTER COLUMN "party" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "case_parties" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
UPDATE "polls" SET "case_parties" = "party_user_ids"::text[];--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "party" text;--> statement-breakpoint
UPDATE "votes" SET "party" = "user_id"::text;--> statement-breakpoint
ALTER TABLE "votes" ALTER COLUMN "party" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_supports_claim_party_uq" ON "claim_supports" USING btree ("claim_id","party");--> statement-breakpoint
CREATE UNIQUE INDEX "rulings_refutation_party_uq" ON "rulings" USING btree ("refutation_id","party");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_poll_party_uq" ON "votes" USING btree ("poll_id","party");--> statement-breakpoint
DROP INDEX "claim_supports_claim_user_uq";--> statement-breakpoint
DROP INDEX "rulings_refutation_user_uq";--> statement-breakpoint
DROP INDEX "votes_poll_user_uq";
