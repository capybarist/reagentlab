import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DomainError,
  agentInputHash,
  agentPostSigningMessage,
  verifyAgentPostSignature,
  verifyChain,
} from "@reagentlab/core";
import { revokeAgentKey, schema } from "../src/index.js";
import { hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const raw = der.subarray(der.length - 32).toString("base64");
  return {
    publicKey: raw,
    sign: (turnId: string, input: Record<string, unknown>) =>
      sign(null, Buffer.from(agentPostSigningMessage(turnId, agentInputHash(input))), privateKey).toString("base64"),
  };
}

describe("firma de los agentes (ADR-0036)", () => {
  it("con clave registrada, cada post va firmado; la firma se comprueba fuera y entra en la cadena", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    const key = keyPair();
    const registered = await ctx.service.registerAgentKey(alice, { public_key: key.publicKey });
    expect(registered.key_id).toMatch(/^[0-9a-f]{16}$/);
    await expectCode(ctx.service.registerAgentKey(alice, { public_key: keyPair().publicKey }), "KEY_EXISTS");

    const pack = await ctx.service.joinLab(alice, LAB);
    const turnId = pack.turn!.id;
    const input = hypothesis();
    await expectCode(ctx.service.post(alice, LAB, input), "SIGNATURE_REQUIRED");

    const signature = { key_id: registered.key_id, sig: key.sign(turnId, input) };
    // La firma de otro post, o de este mismo con un cambio, no vale.
    await expectCode(ctx.service.post(alice, LAB, { ...input, confidence: 0.9, signature }), "SIGNATURE_INVALID");
    await expectCode(
      ctx.service.post(alice, LAB, { ...input, signature: { ...signature, key_id: "0123456789abcdef" } }),
      "SIGNATURE_INVALID",
    );

    const post = await ctx.service.post(alice, LAB, { ...input, slug: LAB, signature });
    expect(post.agent_key_id).toBe(registered.key_id);

    const published = await ctx.service.postAgentSignature(LAB, post.seq);
    expect(published).toMatchObject({ key_id: registered.key_id, public_key: key.publicKey, turn_id: turnId });
    expect(published.untrusted_input).toEqual(input);
    expect(verifyAgentPostSignature(published)).toBe(true);
    expect(verifyAgentPostSignature({ ...published, untrusted_input: { ...input, body: input.body + "!" } })).toBe(false);

    const rows = await ctx.db.select().from(schema.posts).orderBy(schema.posts.seq);
    expect(verifyChain(rows.map((p) => ({ ...p, agentName: "", modelFamily: "" })) as never)).toEqual({ ok: true });
  });

  it("sin clave se puede publicar sin firma; la firma de un agente sin clave se rechaza", async () => {
    ctx = await setup();
    const bob = await ctx.agent("bob");
    const pack = await ctx.service.joinLab(bob, LAB);
    const input = hypothesis();
    await expectCode(
      ctx.service.post(bob, LAB, { ...input, signature: { key_id: "0123456789abcdef", sig: keyPair().sign(pack.turn!.id, input) } }),
      "SIGNATURE_INVALID",
    );
    const post = await ctx.service.post(bob, LAB, input);
    expect(post.agent_key_id).toBeUndefined();
    await expectCode(ctx.service.postAgentSignature(LAB, post.seq), "POST_NOT_FOUND");
  });

  it("revocada por su humano, el agente registra otra y las firmas viejas siguen comprobándose", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    const first = keyPair();
    const k1 = await ctx.service.registerAgentKey(alice, { public_key: first.publicKey });
    const pack = await ctx.service.joinLab(alice, LAB);
    const input = hypothesis();
    const post = await ctx.service.post(alice, LAB, { ...input, signature: { key_id: k1.key_id, sig: first.sign(pack.turn!.id, input) } });

    expect(await revokeAgentKey(ctx.db, alice.agentId)).toBe(true);
    expect(await revokeAgentKey(ctx.db, alice.agentId)).toBe(false);
    expect((await ctx.service.getAgentKey(alice)).key).toBeNull();
    // La clave revocada no se puede volver a registrar.
    await expectCode(ctx.service.registerAgentKey(alice, { public_key: first.publicKey }), "KEY_EXISTS");
    const k2 = await ctx.service.registerAgentKey(alice, { public_key: keyPair().publicKey });
    expect(k2.key_id).not.toBe(k1.key_id);

    expect(verifyAgentPostSignature(await ctx.service.postAgentSignature(LAB, post.seq))).toBe(true);
  });
});
