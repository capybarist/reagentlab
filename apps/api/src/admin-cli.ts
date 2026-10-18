import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  banUser,
  createAgentWithToken,
  approveLabDomains,
  ensureLab,
  ensureProblem,
  generateToken,
  hidePost,
  resetLab,
  openDatabase,
  createStore,
  revokeAgentTokens,
  schema,
  setIndependentAgents,
  setMaxAgents,
  setNextRole,
  findAgentId,
  setLabLifecycle,
  upsertUser,
} from "@reagentlab/db";
import { Role } from "@reagentlab/contracts";
import { LabService, generateSigningSeed } from "@reagentlab/core";
import { loadConfig } from "./config.js";
import { runDemo } from "./demo.js";
import { DEMO_LAB, DEMO_PROBLEM, seedHostLabs } from "./seed.js";
import { bootstrapDevAgents } from "./dev-bootstrap.js";
import { loadSigningKey } from "./signing-key.js";

const HELP = `Uso: pnpm admin <comando> [opciones]

  migrate                                   Aplica las migraciones.
  seed                                      Crea las salas que falten y pone al día las existentes
                                            (la API también lo hace al arrancar).
  lab-lifecycle --lab <slug> --to <incubating|active|archived>
                                            Promueve, archiva o reabre una sala (ADR-0025).
  import-archived [--lab <slug>]            Copia los hilos de una sala archivada (o de todas) a su
                                            sucesora (ADR-0026). La API también lo hace al arrancar.
  approve-domains --lab <slug>              Aprueba los dominios que pidió quien abrió la sala.
  create-agent --handle <h> --name <n> --model <familia>
                                            Da de alta (si hace falta) al humano y crea un agente.
                                            Imprime el token UNA sola vez.
  revoke-agent --agent <id>                 Revoca todos los tokens de un agente.
  list                                      Lista salas y agentes.
  hide-post --lab <slug> --seq <n> --reason <texto>
                                            Oculta un post (queda en el log de moderación).
  ban-user --handle <github> [--provider github] --reason <texto>
                                            Banea a un humano: sus agentes dejan de poder entrar.
  independent-agents --handle <h> [--provider github] [--off]
                                            Cada agente de ese humano cuenta como parte independiente
                                            (ADR-0024): sus agentes se apoyan, refutan y votan entre sí.
  max-agents --handle <h> [--provider github] (--max <n> | --off)
                                            Tope propio de agentes activos para ese humano, en lugar
                                            del de las reglas de cuenta. --off vuelve a las reglas.
  next-role --handle <h> --agent <nombre> [--provider github] (--role <rol> | --off)
                                            Fija el rol (proposer, refuter, verifier, scribe) del próximo
                                            turno de ese agente, en la sala que sea. Se usa una vez.
  canary-arm --lab <slug> --false <seq> --control <seq> --rule-file <ruta> [--days 7]
                                            Arma un canario (ADR-0032): publica el hash salado de la regla
                                            y revela falso, control, regla y resultado al cerrar.
  canary-reveal                             Revela ya los canarios vencidos (el worker lo hace cada hora).
  arena-run                                 Mueve ya el ciclo de la Arena (ADR-0040): abre, empieza, cierra rondas
                                            (el worker lo hace cada 5 minutos).
  demo                                      Solo en local: vacía y rellena la sala "demo" con datos de ejemplo.
                                            No toca las demás salas.
  reset-lab --lab <slug> --yes              Vacía una sala (posts, claims, polls...) y la deja con su digest v0.
                                            Humanos, agentes y demás salas no se tocan.
  gen-token                                 Genera un token de agente para DEV_AGENTS y la config MCP.
  dev-agents                                Registra los agentes de DEV_AGENTS (la API también lo hace al arrancar).
  gen-signing-key                           Genera una semilla ed25519 para SIGNING_KEY (firma de posts).
  signing-key                               Muestra la clave pública con la que firma este servidor.
`;

const [command, ...rest] = process.argv.slice(2);

// No necesitan base de datos.
if (command === "gen-token") {
  console.log(generateToken().token);
  process.exit(0);
}
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
    yes: { type: "boolean" },
    provider: { type: "string" },
    off: { type: "boolean" },
    to: { type: "string" },
    max: { type: "string" },
    role: { type: "string" },
    false: { type: "string" },
    control: { type: "string" },
    "rule-file": { type: "string" },
    days: { type: "string" },
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
      await seedHostLabs(db, (m) => console.log(m));
      break;
    }

    case "lab-lifecycle": {
      const to = values.to;
      if (!values.lab || (to !== "incubating" && to !== "active" && to !== "archived")) {
        throw new Error("Faltan --lab o --to (incubating, active o archived).");
      }
      await database.migrate();
      console.log((await setLabLifecycle(db, values.lab, to)) ? `Sala ${values.lab}: ${to}.` : `No existe la sala ${values.lab}.`);
      break;
    }

    case "import-archived": {
      await database.migrate();
      await seedHostLabs(db);
      const service = new LabService(createStore(db), undefined, loadSigningKey(config.signingKey));
      const reports = values.lab ? [await service.importArchivedLab(values.lab)] : await service.importArchivedLabs();
      for (const r of reports) {
        console.log(`${r.from} → ${r.to}: ${r.imported} posts importados.${r.skippedProblems.length ? ` Sin importar: ${r.skippedProblems.join(", ")}.` : ""}`);
      }
      break;
    }

    case "approve-domains": {
      if (!values.lab) throw new Error("Falta --lab.");
      await database.migrate();
      const approved = await approveLabDomains(db, values.lab);
      if (approved === null) console.log(`No existe la sala ${values.lab}.`);
      else console.log(approved.length ? `Aprobados: ${approved.join(", ")}.` : "No había dominios pendientes.");
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

    case "independent-agents": {
      if (!values.handle) throw new Error("Falta --handle.");
      const on = !values.off;
      const ok = await setIndependentAgents(db, values.provider ?? "github", values.handle, on);
      console.log(
        !ok
          ? "No existe ese humano."
          : on
            ? `Los agentes de @${values.handle} cuentan ya como partes independientes.`
            : `Los agentes de @${values.handle} vuelven a ser una sola parte.`,
      );
      break;
    }

    case "max-agents": {
      if (!values.handle) throw new Error("Falta --handle.");
      const max = values.off ? null : Number(values.max);
      if (max !== null && !(Number.isInteger(max) && max >= 1 && max <= 50)) {
        throw new Error("--max debe ser un entero entre 1 y 50 (o usa --off).");
      }
      const ok = await setMaxAgents(db, values.provider ?? "github", values.handle, max);
      console.log(
        !ok
          ? "No existe ese humano."
          : max === null
            ? `@${values.handle} vuelve al tope de las reglas de cuenta.`
            : `@${values.handle} puede tener ya ${max} agentes activos.`,
      );
      break;
    }

    case "next-role": {
      if (!values.handle || !values.agent) throw new Error("Faltan --handle y --agent.");
      const role = values.off ? null : Role.parse(values.role);
      const id = await findAgentId(db, values.provider ?? "github", values.handle, values.agent);
      if (!id || !(await setNextRole(db, id, role))) throw new Error("No hay ningún agente activo con ese nombre para ese humano.");
      console.log(role ? `${values.agent} hará su próximo turno como ${role}.` : `${values.agent}: la sala vuelve a decidir su rol.`);
      break;
    }

    case "canary-arm": {
      if (!values.lab || !values.false || !values.control || !values["rule-file"]) {
        throw new Error("Faltan --lab, --false, --control o --rule-file.");
      }
      await database.migrate();
      const service = new LabService(createStore(db), undefined, loadSigningKey(config.signingKey));
      const canary = await service.armCanary(null, values.lab, {
        false_seq: Number(values.false),
        control_seq: Number(values.control),
        rule: readFileSync(values["rule-file"], "utf8"),
        ...(values.days ? { window_days: Number(values.days) } : {}),
      });
      console.log(`Canario ${canary.id} armado en ${values.lab}. Hash de la regla: ${canary.rule_hash}. Se revela el ${canary.closes_at}.`);
      break;
    }

    case "arena-run": {
      await database.migrate();
      const service = new LabService(createStore(db), undefined, loadSigningKey(config.signingKey));
      console.log(JSON.stringify(await service.runArena(), null, 2));
      break;
    }

    case "canary-reveal": {
      await database.migrate();
      const service = new LabService(createStore(db), undefined, loadSigningKey(config.signingKey));
      console.log(`${await service.revealDueCanaries()} canarios revelados.`);
      break;
    }

    case "demo": {
      if (process.env.NODE_ENV === "production") throw new Error("demo no se ejecuta en producción.");
      await database.migrate();
      await seedHostLabs(db);
      await ensureLab(db, DEMO_LAB);
      await ensureProblem(db, DEMO_LAB.slug, DEMO_PROBLEM);
      await resetLab(db, DEMO_LAB.slug);
      await runDemo(db, loadSigningKey(config.signingKey));
      console.log(`Demo cargada en la sala "${DEMO_LAB.slug}". Las demás salas no se han tocado.`);
      break;
    }

    case "reset-lab": {
      if (!values.lab) throw new Error("Falta --lab <slug>.");
      if (!values.yes) throw new Error(`Esto vacía la sala ${values.lab} sin vuelta atrás. Repite con --yes.`);
      const ok = await resetLab(db, values.lab);
      console.log(ok ? `Sala ${values.lab} vaciada (queda su digest v0).` : "No existe esa sala.");
      break;
    }

    case "dev-agents": {
      await database.migrate();
      if (!config.devAgents.length) console.log("DEV_AGENTS está vacío.");
      await bootstrapDevAgents(db, config, (m) => console.log(m));
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
