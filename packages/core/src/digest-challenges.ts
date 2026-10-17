import type { DigestChallengeView, Independence } from "@reagentlab/contracts";
import { partyOf } from "./party.js";
import type { DigestChallengeRow, DigestRow, Repos } from "./ports.js";

/**
 * Impugnación de digests (ADR-0037). Puras: quién puede impugnar y quién dictaminar.
 * Las partes se comparan como en el resto (ADR-0023): el escriba no se impugna a sí
 * mismo y nadie dictamina un caso en el que es parte.
 */

export type ChallengeBlock = "own_digest" | "already_challenged" | "already_upheld";

export function challengeBlock(
  authorParty: string | null,
  challengerParty: string,
  existing: readonly Pick<DigestChallengeRow, "challengerParty" | "status">[],
): ChallengeBlock | null {
  if (authorParty === challengerParty) return "own_digest";
  if (existing.some((c) => c.status === "upheld")) return "already_upheld";
  if (existing.some((c) => c.challengerParty === challengerParty)) return "already_challenged";
  return null;
}

export type ChallengeRulingBlock = "closed" | "party_to_the_case";

export function challengeRulingBlock(
  c: Pick<DigestChallengeRow, "challengerParty" | "status">,
  authorParty: string | null,
  rulerParty: string,
): ChallengeRulingBlock | null {
  if (c.status !== "pending") return "closed";
  if (rulerParty === c.challengerParty || rulerParty === authorParty) return "party_to_the_case";
  return null;
}

/** Parte del escriba que escribió el digest; null si lo escribió el servidor (v0). */
export async function digestAuthorParty(r: Repos, digest: DigestRow, independence: Independence): Promise<string | null> {
  if (!digest.authorTurnId) return null;
  const turn = await r.getTurn(digest.authorTurnId);
  const agent = turn ? await r.getAgent(turn.agentId) : null;
  return agent ? partyOf(agent, independence) : null;
}

/** Impugnaciones pendientes del digest vigente que esta parte puede dictaminar. */
export async function rulableChallenges(
  r: Repos,
  digest: DigestRow | null,
  independence: Independence,
  party: string,
): Promise<DigestChallengeRow[]> {
  if (!digest?.problemId) return [];
  const pending = (await r.listDigestChallenges(digest.problemId, digest.id)).filter((c) => c.status === "pending");
  if (!pending.length) return [];
  const author = await digestAuthorParty(r, digest, independence);
  return pending.filter((c) => !challengeRulingBlock(c, author, party));
}

/** ¿Tiene el digest vigente una impugnación aceptada? Entonces hace falta escriba. */
export async function digestUpheld(r: Repos, digest: DigestRow | null): Promise<DigestChallengeRow[]> {
  if (!digest?.problemId) return [];
  return (await r.listDigestChallenges(digest.problemId, digest.id)).filter((c) => c.status === "upheld");
}

export function toDigestChallengeView(c: DigestChallengeRow, problem: string): DigestChallengeView {
  return {
    id: c.id,
    problem,
    digest_version: c.digestVersion,
    status: c.status,
    challenger: { name: c.challengerName ?? "", model_family: c.challengerFamily ?? "" },
    untrusted_reason: c.reason,
    created_at: c.createdAt.toISOString(),
    ...(c.ruledAt && c.rulingReasoning
      ? {
          ruling: {
            agent: { name: c.rulerName ?? "", model_family: c.rulerFamily ?? "" },
            untrusted_reasoning: c.rulingReasoning,
            ruled_at: c.ruledAt.toISOString(),
          },
        }
      : {}),
  };
}
