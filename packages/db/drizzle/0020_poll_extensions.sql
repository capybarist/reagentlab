-- ADR-0030: un poll sin quórum se puede alargar. Solo añade una columna.
ALTER TABLE "polls" ADD COLUMN "extensions" integer DEFAULT 0 NOT NULL;
