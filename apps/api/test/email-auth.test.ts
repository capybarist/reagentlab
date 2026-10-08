import { type Database, openDatabase } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const KEY = "test-service-key";
let now = new Date("2026-10-08T10:00:00Z");
const sent: { to: string; subject: string; body: string }[] = [];

let database: Database;
let app: FastifyInstance;

const post = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { "x-reagent-service-key": KEY }, payload });
const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.subject)![1]!;
const later = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));

beforeAll(async () => {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  ({ app } = buildApp({
    db: database.db,
    tokenPepper: "p",
    webServiceKey: KEY,
    clock: { now: () => now },
    adminHandles: ["ada"],
    mailer: { send: async (to, subject, body) => void sent.push({ to, subject, body }) },
  }));
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("login con email y contraseña (ADR-0022)", () => {
  it("alta con código, login, y una cuenta nueva con un solo agente", async () => {
    const signup = await post("/v1/account/auth/email/signup", { email: "Ada@Example.org", password: "correct horse battery", handle: "ada" });
    expect(signup.statusCode).toBe(200);
    expect(sent.at(-1)!.to).toBe("ada@example.org");
    expect(sent.at(-1)!.body).not.toContain("correct horse");

    // Sin código no hay cuenta.
    expect((await post("/v1/account/auth/email/login", { email: "ada@example.org", password: "correct horse battery" })).statusCode).toBe(401);
    expect((await post("/v1/account/auth/email/verify", { email: "ada@example.org", code: "000000" })).json().code).toBe("CODE_INVALID");

    const verified = await post("/v1/account/auth/email/verify", { email: "ada@example.org", code: lastCode() });
    expect(verified.statusCode).toBe(200);
    // "ada" en ADMIN_HANDLES es un handle de GitHub: una cuenta de email con ese nombre no es admin.
    expect(verified.json()).toMatchObject({ provider: "email", handle: "ada", is_admin: false, can_create_agents: true });

    const login = await post("/v1/account/auth/email/login", { email: "ada@example.org", password: "correct horse battery" });
    expect(login.json().id).toBe(verified.json().id);
    expect((await post("/v1/account/auth/email/login", { email: "ada@example.org", password: "wrong password!" })).json().code).toBe(
      "INVALID_CREDENTIALS",
    );

    const headers = { "x-reagent-service-key": KEY, "x-reagent-user": login.json().id };
    const add = (name: string) => app.inject({ method: "POST", url: "/v1/account/agents", headers, payload: { name, model_family: "claude" } });
    expect((await add("first")).statusCode).toBe(201);
    expect((await add("second")).json().code).toBe("AGENT_LIMIT_REACHED");
  });

  it("no repite email ni handle, y limita el reenvío de códigos", async () => {
    later(5);
    expect((await post("/v1/account/auth/email/signup", { email: "ada@example.org", password: "another password", handle: "xy" })).json().code).toBe(
      "EMAIL_TAKEN",
    );
    expect((await post("/v1/account/auth/email/signup", { email: "bob@example.org", password: "bob password 1", handle: "ada" })).statusCode).toBe(200);
    expect((await post("/v1/account/auth/email/signup", { email: "bob@example.org", password: "bob password 1", handle: "ada" })).json().code).toBe(
      "TOO_MANY_REQUESTS",
    );
    const bob = await post("/v1/account/auth/email/verify", { email: "bob@example.org", code: lastCode() });
    expect(bob.json().handle).toBe("ada-2");
  });

  it("el código caduca y tiene un tope de intentos", async () => {
    later(5);
    await post("/v1/account/auth/email/signup", { email: "cy@example.org", password: "cy password 12", handle: "cy" });
    const code = lastCode();
    for (let i = 0; i < 5; i++) await post("/v1/account/auth/email/verify", { email: "cy@example.org", code: "999999" === code ? "888888" : "999999" });
    expect((await post("/v1/account/auth/email/verify", { email: "cy@example.org", code })).json().code).toBe("CODE_INVALID");

    later(2);
    await post("/v1/account/auth/email/signup", { email: "cy@example.org", password: "cy password 12", handle: "cy" });
    const fresh = lastCode();
    later(16);
    expect((await post("/v1/account/auth/email/verify", { email: "cy@example.org", code: fresh })).json().code).toBe("CODE_INVALID");
  });

  it("cambio de contraseña con código, sin revelar si el email existe", async () => {
    later(5);
    const before = sent.length;
    expect((await post("/v1/account/auth/email/reset-request", { email: "nobody@example.org" })).statusCode).toBe(200);
    expect(sent.length).toBe(before);

    await post("/v1/account/auth/email/reset-request", { email: "ada@example.org" });
    expect(sent.length).toBe(before + 1);
    const reset = await post("/v1/account/auth/email/reset", { email: "ada@example.org", code: lastCode(), password: "a brand new password" });
    expect(reset.statusCode).toBe(200);
    expect((await post("/v1/account/auth/email/login", { email: "ada@example.org", password: "correct horse battery" })).statusCode).toBe(401);
    expect((await post("/v1/account/auth/email/login", { email: "ada@example.org", password: "a brand new password" })).statusCode).toBe(200);
  });

  it("bloquea un rato tras muchos intentos fallidos", async () => {
    for (let i = 0; i < 10; i++) await post("/v1/account/auth/email/login", { email: "bob@example.org", password: `guess number ${i}` });
    expect((await post("/v1/account/auth/email/login", { email: "bob@example.org", password: "bob password 1" })).json().code).toBe("TOO_MANY_REQUESTS");
    later(16);
    expect((await post("/v1/account/auth/email/login", { email: "bob@example.org", password: "bob password 1" })).statusCode).toBe(200);
  });

  it("Google: el handle sugerido se hace único y no cambia en el siguiente login", async () => {
    const g = (handle: string) =>
      post("/v1/account/users", { provider: "google", provider_id: "g-123", handle });
    const first = (await g("ada")).json();
    expect(first).toMatchObject({ provider: "google", handle: "ada-3", is_admin: false });
    expect((await g("someone-else")).json().handle).toBe("ada-3");
  });
});
