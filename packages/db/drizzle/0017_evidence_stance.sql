-- ADR-0028: postura de las evidencias. Solo añade la columna; las evidencias anteriores quedan
-- con stance NULL y siguen contando como apoyo, como cuando se publicaron.
ALTER TABLE "posts" ADD COLUMN "stance" text;--> statement-breakpoint
-- Reparación (ADR-0028): una parte que verificó un claim con "fails" deja de contar como apoyo.
-- Solo toca claims vivos sin adoptar; recalcula el recuento a partir de claim_supports. Idempotente.
UPDATE "claims" AS c SET "support_count" = (
	SELECT count(*)::int FROM "claim_supports" s
	WHERE s."claim_id" = c."id"
	AND NOT EXISTS (
		SELECT 1 FROM "verifications" v
		WHERE v."claim_id" = c."id" AND v."party" = s."party" AND v."outcome" = 'fails'
	)
) WHERE c."status" IN ('open', 'supported');--> statement-breakpoint
-- Y un claim sin apoyos efectivos, o con más verificaciones fallidas que confirmadas, no está apoyado.
UPDATE "claims" AS c SET "status" = 'open' WHERE c."status" = 'supported' AND (
	c."support_count" = 0
	OR (SELECT count(*) FROM "verifications" v WHERE v."claim_id" = c."id" AND v."outcome" = 'fails')
	 > (SELECT count(*) FROM "verifications" v WHERE v."claim_id" = c."id" AND v."outcome" = 'confirms')
);
