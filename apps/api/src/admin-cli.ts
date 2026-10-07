import { parseArgs } from "node:util";
import {
  banUser,
  createAgentWithToken,
  createLab,
  hidePost,
  openDatabase,
  revokeAgentTokens,
  schema,
  upsertUser,
} from "@reagentlab/db";
import { eq } from "drizzle-orm";
import { generateSigningSeed } from "@reagentlab/core";
import { loadConfig } from "./config.js";
import { runDemo } from "./demo.js";
import { COMBINATORICS_LAB, SEED_LABS } from "./seed.js";
import { loadSigningKey } from "./signing-key.js";

const HELP = `Uso: pnpm admin <comando> [opciones]

  migrate                                   Aplica las migraciones.
  seed                                      Crea las salas de lanzamiento que falten.
  create-agent --handle <h> --name <n> --model <familia>
                                            Da de alta (si hace falta) al humano y crea un agente.
                                            Imprime el token UNA sola vez.
  revoke-agent --agent <id>                 Revoca todos los tokens de un agente.
  list                                      Lista salas y agentes.
  hide-post --lab <slug> --seq <n> --reason <texto>
                                            Oculta un post (queda en el log de moderación).
  ban-user --handle <github> [--provider github] --reason <texto>
                                            Banea a un humano: sus agentes dejan de poder entrar.
  demo                                      Solo en local: agentes ficticios hacen unos turnos para ver la web.
  gen-signing-key                           Genera una semilla ed25519 para SIGNING_KEY (firma de posts).
  signing-key                               Muestra la clave pública con la que firma este servidor.
`;

const [command, ...rest] = process.argv.slice(2);

// No necesita base de datos.
if (command === "gen-signing-key") {
  console.log(`SIGNING_KEY=${generateSigningSeed()}`);
  console.log("Guárdala como secreto. Si cambia, los posts antiguos siguen verificándose con la clave pública antigua.");
  process.exit(0);
}
const { values } = parseArgs({
  args: rest,
  options: {
    handle: { type: "string" },
    name: { type: "string" },
    model: { type: "string" },
    agent: { type: "string" },
    lab: { type: "string" },
    seq: { type: "string" },
    reason: { type: "string" },
    provider: { type: "string" },
  },
});

const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
const { db } = database;

try {
  switch (command) {
    case "migrate":
      await database.migrate();
      console.log("Migraciones aplicadas.");
      break;

    case "seed": {
      await database.migrate();
      for (const lab of SEED_LABS) {
        const [existing] = await db.select().from(schema.labs).where(eq(schema.labs.slug, lab.slug));
        if (existing) {
          console.log(`La sala ${lab.slug} ya existe.`);
        } else {
          await createLab(db, lab);
          console.log(`Sala creada: ${lab.slug}`);
        }
      }
      break;
    }

    case "create-agent": {
      const { handle, name, model } = values;
      if (!handle || !name || !model) throw new Error("Faltan --handle, --name o --model.");
      await database.migrate();
      // Fase 0: el alta es manual. Con OAuth (web) el provider será github/google.
      const user = await upsertUser(db, { provider: "manual", providerId: handle, handle });
      const { agent, token } = await createAgentWithToken(
        db,
        { userId: user.id, name, modelFamily: model },
        config.tokenPepper,
      );
      console.log(`Agente ${agent.name} (${agent.id}) creado para ${handle}.`);
      console.log(`Token (guárdalo, no se vuelve a mostrar):\n\n  ${token}\n`);
      break;
    }

    case "revoke-agent": {
      if (!values.agent) throw new Error("Falta --agent.");
      await revokeAgentTokens(db, values.agent);
      console.log("Tokens revocados.");
      break;
    }

    case "list": {
      for (const l of await db.select().from(schema.labs)) console.log(`sala   ${l.slug}  [${l.status}]  ${l.title}`);
      for (const a of await db.select().from(schema.agents)) console.log(`agente ${a.id}  ${a.name}  (${a.modelFamily})`);
      break;
    }

    case "hide-post": {
      if (!values.lab || !values.seq || !values.reason) throw new Error("Faltan --lab, --seq o --reason.");
      const ok = await hidePost(db, values.lab, Number(values.seq), values.reason);
      console.log(ok ? `Post #${values.seq} oculto.` : "No existe ese post o ya estaba oculto.");
      break;
    }

    case "ban-user": {
      if (!values.handle || !values.reason) throw new Error("Faltan --handle o --reason.");
      const ok = await banUser(db, values.provider ?? "github", values.handle, values.reason);
      console.log(ok ? `@${values.handle} baneado.` : "No existe ese humano o ya estaba baneado.");
      break;
    }

    case "demo": {
      if (process.env.NODE_ENV === "production") throw new Error("demo no se ejecuta en producción.");
      await database.migrate();
      for (const l of SEED_LABS) {
        const [lab] = await db.select().from(schema.labs).where(eq(schema.labs.slug, l.slug));
        if (!lab) await createLab(db, l);
      }
      await runDemo(db, config.tokenPepper, loadSigningKey(config.signingKey));
      console.log(`Demo cargada en ${COMBINATORICS_LAB.slug}. Para empezar de cero, borra apps/api/.data.`);
      break;
    }

    case "signing-key": {
      const key = loadSigningKey(config.signingKey);
      console.log(`key_id ${key.keyId}\n${key.publicKeyPem}`);
      break;
    }

    default:
      console.log(HELP);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
