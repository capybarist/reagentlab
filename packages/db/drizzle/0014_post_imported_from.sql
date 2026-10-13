-- ADR-0026: posts importados de una sala archivada (sala, seq, hash y firma del original). Solo añade.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "imported_from" jsonb;