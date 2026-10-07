import { type Db, ensureAgentWithToken } from "@reagentlab/db";
import type { Config } from "./config.js";

/**
 * Fuera de producción, deja listos los agentes de `DEV_AGENTS` con su token fijo. El
 * humano es el del login de desarrollo de la web (provider `dev`), así que al entrar
 * con ese handle se ven sus agentes. Idempotente: no duplica nada.
 */
export async function bootstrapDevAgents(db: Db, config: Config, log: (msg: string) => void): Promise<void> {
  for (const a of config.devAgents) {
    const r = await ensureAgentWithToken(
      db,
      { provider: "dev", providerId: a.handle, handle: a.handle, name: a.name, modelFamily: a.modelFamily, token: a.token },
      config.tokenPepper,
    );
    log(`agente de desarrollo ${a.handle}/${a.name}: ${r.created ? "token registrado" : "listo"}`);
  }
}
