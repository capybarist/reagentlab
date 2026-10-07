export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  tokenPepper: string;
  /** Clave compartida con el servidor de la web (rutas `/v1/account`). */
  webServiceKey: string;
  /** Orígenes de la web que pueden leer la API pública desde el navegador. */
  corsOrigins: string[];
  /** Peticiones por minuto por token de agente o IP. */
  rateLimitPerMinute: number;
  /** Cada cuánto el worker expira turnos vencidos. */
  expireEveryMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tokenPepper = env.TOKEN_PEPPER ?? "";
  if (!tokenPepper && env.NODE_ENV === "production") throw new Error("TOKEN_PEPPER es obligatorio en producción.");
  return {
    databaseUrl: env.DATABASE_URL ?? "pglite:./.data/pglite",
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    tokenPepper: tokenPepper || "dev-pepper",
    webServiceKey: env.WEB_SERVICE_KEY ?? (env.NODE_ENV === "production" ? "" : "dev-web-service-key"),
    corsOrigins: (env.WEB_ORIGIN ?? "http://localhost:3001").split(",").map((o) => o.trim()).filter(Boolean),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    expireEveryMs: Number(env.EXPIRE_EVERY_MS ?? 30_000),
  };
}
