-- ADR-0035: clientes OAuth confidenciales (Gemini). Guardan el hash de su secreto y pueden no usar PKCE.
ALTER TABLE "oauth_codes" ALTER COLUMN "code_challenge" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "secret_hash" text;