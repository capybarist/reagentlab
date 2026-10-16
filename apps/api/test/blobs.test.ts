import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIGEST_SECTIONS } from "@reagentlab/contracts";
import type { Actor } from "@reagentlab/core";
import { type Database, createAgentWithToken, createLab, ensureProblem, openDatabase, upsertUser } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { fsBlobStore } from "../src/blob-store-fs.js";
import { presignUrl } from "../src/blob-store-s3.js";

/** Archivos de artefactos (ADR-0034) de punta a punta con el almacenamiento local. */

const PEPPER = "blob-pepper";
const LAB = "combinatorics";
let database: Database;
let app: FastifyInstance;
let service: ReturnType<typeof buildApp>["service"];
let baseUrl: string;
let dir: string;
const fsOpts = { dir: "", publicUrl: "" };

async function agent(handle: string, model = "claude"): Promise<Actor & { token: string }> {
  const user = await upsertUser(database.db, { provider: "github", providerId: handle, handle });
  const { agent, token } = await createAgentWithToken(database.db, { userId: user.id, name: handle, modelFamily: model }, PEPPER);
  return { agentId: agent.id, agentName: agent.name, userId: user.id, modelFamily: model, token };
}

const digest = DIGEST_SECTIONS.map((s) => `${s}\n\nNothing yet.`).join("\n\n") + "\n\n" + "Padding for the minimum digest length. ".repeat(6);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rl-blobs-"));
  fsOpts.dir = dir;
  database = await openDatabase("pglite:memory");
  await database.migrate();
  await createLab(database.db, {
    slug: LAB,
    title: "Combinatorics: bounds",
    description: "Improve known bounds with constructions that code can verify.",
    rules: { allowed_domains: ["oeis.org"] },
    initialDigestMd: digest,
  });
  await ensureProblem(database.db, LAB, {
    slug: "main",
    title: "Improve the bound",
    statement: "Improve the best known bound with a construction or an argument that others can check step by step.",
  });
  ({ app, service } = buildApp({ db: database.db, tokenPepper: PEPPER, rateLimitPerMinute: 0, blobs: fsBlobStore(fsOpts) }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  fsOpts.publicUrl = baseUrl;
});

afterAll(async () => {
  await app.close();
  await database.close();
  await rm(dir, { recursive: true, force: true });
});

describe("archivos de artefactos (ADR-0034)", () => {
  it("se pide permiso, se sube, se cita en el artefacto y se descarga por su sha256", async () => {
    const alice = await agent("alice");
    const body = Buffer.from("n,bound\n7,45\n");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const auth = { authorization: `Bearer ${alice.token}`, "content-type": "application/json" };

    const ticketRes = await fetch(`${baseUrl}/v1/uploads`, { method: "POST", headers: auth, body: JSON.stringify({ sha256, bytes: body.length }) });
    expect(ticketRes.status).toBe(201);
    const ticket = await ticketRes.json();
    expect(ticket).toMatchObject({ sha256, already_stored: false, method: "PUT" });

    // Un cuerpo que no tiene ese sha256 no se guarda.
    const bad = await fetch(ticket.upload_url, { method: "PUT", headers: ticket.headers, body: Buffer.from("other") });
    expect(bad.status).toBe(400);
    const put = await fetch(ticket.upload_url, { method: "PUT", headers: ticket.headers, body });
    expect(put.status).toBe(200);

    const artifact = (files: unknown[]) => ({
      type: "hypothesis",
      body: "A substantive contribution with enough content to pass the minimum length the server requires.",
      confidence: 0.6,
      claim_kind: "computation",
      predictions: ["The bound holds for every n up to 40"],
      falsifiers: ["A construction for some n <= 40 that beats the bound"],
      evidence: [{ kind: "computation", description: "Read the table with the attached script; n = 7 gives 45." }],
      artifact: {
        language: "python",
        environment: "python:3.12",
        command: "python main.py",
        code: "print(open('table.csv').read().split()[1].split(',')[1])\n",
        expected_output: "45\n",
        files,
      },
    });
    await service.joinLab(alice, LAB);
    const missing = [{ name: "table.csv", sha256: "b".repeat(64), bytes: 10 }];
    await expect(service.post(alice, LAB, artifact(missing))).rejects.toMatchObject({ code: "BLOB_NOT_FOUND" });
    await expect(service.post(alice, LAB, artifact([{ name: "main.py", sha256, bytes: body.length }]))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const post = await service.post(alice, LAB, artifact([{ name: "table.csv", sha256, bytes: body.length }]));

    const full = await service.getArtifact(LAB, post.seq);
    expect(full.files).toEqual([{ untrusted_name: "table.csv", sha256, bytes: body.length, path: `/v1/blobs/${sha256}` }]);

    const download = await fetch(`${baseUrl}${full.files![0]!.path}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(body);

    // Pedirlo otra vez: ya está guardado.
    const again = await (await fetch(`${baseUrl}/v1/uploads`, { method: "POST", headers: auth, body: JSON.stringify({ sha256, bytes: body.length }) })).json();
    expect(again).toEqual({ sha256, already_stored: true });
  });

  it("una URL firmada no vale para otro archivo ni para otra operación", async () => {
    const store = fsBlobStore(fsOpts);
    const sha = "c".repeat(64);
    const u = new URL(await store.presignPut(sha, 1, 60).then((t) => t.url));
    const exp = u.searchParams.get("exp")!;
    const sig = u.searchParams.get("sig")!;
    expect(store.verify("put", sha, exp, sig)).toBe(true);
    expect(store.verify("get", sha, exp, sig)).toBe(false);
    expect(store.verify("put", "d".repeat(64), exp, sig)).toBe(false);
    expect(store.verify("put", sha, exp, sig, new Date(Date.now() + 120_000))).toBe(false);
  });

  it("las URLs S3 coinciden con la firma SigV4 de referencia del SDK de AWS", () => {
    const sha = "a".repeat(64);
    const base = {
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "reagentlab",
      region: "auto",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      key: `artifacts/${sha}`,
      expiresSec: 900,
      now: new Date("2026-10-16T12:00:00Z"),
    };
    // Vectores generados con @smithy/signature-v4 (SignatureV4.presign) para la misma petición.
    expect(presignUrl({ ...base, method: "GET", headers: {} })).toContain(
      "X-Amz-Signature=53f3f79691004de0afee60cba1297388f537ddc331cb56abc9b63e8c03b5e7d1",
    );
    const put = presignUrl({
      ...base,
      method: "PUT",
      headers: { "x-amz-checksum-sha256": Buffer.from(sha, "hex").toString("base64") },
    });
    expect(put).toContain("X-Amz-SignedHeaders=host%3Bx-amz-checksum-sha256");
    expect(put).toContain("X-Amz-Signature=1ffda21f250385e2c902c6d529faebbcab0896be1d2c6b099a9f0111d63d9120");
  });
});
