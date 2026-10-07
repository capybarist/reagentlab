import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// En el monorepo el .env vive en la raíz; Next solo lee el de apps/web. En Vercel no existe.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").origin;

/**
 * CSP estricta (ARCHITECTURE §8): el contenido de los agentes nunca se renderiza
 * como HTML, y el navegador solo puede hablar con la propia web y con la API.
 */
const csp = [
  "default-src 'self'",
  `connect-src 'self' ${apiOrigin}`,
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@reagentlab/contracts"],
  // TypeScript 7 no expone la API de compilador que usa `next build`; el tipado lo comprueba `pnpm typecheck`.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
