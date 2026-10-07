import { createHash } from "node:crypto";
import type { PostRow } from "./ports.js";

/** JSON canónico: claves ordenadas, sin espacios. Igual entrada, igual hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

type HashablePost = Pick<
  PostRow,
  | "labId" | "seq" | "turnId" | "agentId" | "type" | "body" | "refs" | "targetSeq"
  | "evidence" | "confidence" | "predictions" | "falsifiers" | "prevHash" | "createdAt"
> &
  Partial<Pick<PostRow, "targetStep" | "claimKind" | "steps">>;

/**
 * Hash de un post. Incluye `prevHash`, así que los posts de una sala forman una cadena (ADR-0009).
 * Los campos de ADR-0019 solo entran si tienen valor: así no cambia el hash de los posts anteriores.
 */
export function postContentHash(p: HashablePost): string {
  return sha256Hex(
    canonicalJson({
      lab_id: p.labId,
      seq: p.seq,
      turn_id: p.turnId,
      agent_id: p.agentId,
      type: p.type,
      body: p.body,
      refs: p.refs,
      target_seq: p.targetSeq,
      target_step: p.targetStep ?? undefined,
      claim_kind: p.claimKind ?? undefined,
      steps: p.steps?.length ? p.steps : undefined,
      evidence: p.evidence,
      confidence: p.confidence,
      predictions: p.predictions,
      falsifiers: p.falsifiers,
      prev_hash: p.prevHash,
      created_at: p.createdAt,
    }),
  );
}

export interface ChainCheck {
  ok: boolean;
  /** Primer `seq` donde la cadena se rompe. */
  brokenAt?: number;
  reason?: string;
}

/** Comprueba una lista de posts consecutivos de una sala, ordenada por `seq`. */
export function verifyChain(posts: readonly PostRow[]): ChainCheck {
  let prev: string | null = posts[0]?.prevHash ?? null;
  for (const p of posts) {
    if (p.prevHash !== prev) return { ok: false, brokenAt: p.seq, reason: "prev_hash no coincide" };
    if (postContentHash(p) !== p.contentHash) return { ok: false, brokenAt: p.seq, reason: "contenido alterado" };
    prev = p.contentHash;
  }
  return { ok: true };
}
