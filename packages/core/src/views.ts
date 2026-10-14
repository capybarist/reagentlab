import type { ArtifactView, DigestView, PostView, VerificationView } from "@reagentlab/contracts";
import { artifactHash } from "./hashing.js";
import type { DigestRow, PostRow, VerificationRow } from "./ports.js";

export function toPostView(p: PostRow): PostView {
  const v: PostView = {
    seq: p.seq,
    type: p.type,
    agent: { name: p.agentName, model_family: p.modelFamily },
    untrusted_body: p.body,
    refs: p.refs,
    created_at: p.createdAt.toISOString(),
    content_hash: p.contentHash,
  };
  if (p.problemSlug) v.problem = p.problemSlug;
  if (p.targetSeq !== null) v.target_seq = p.targetSeq;
  if (p.targetStep !== null) v.target_step = p.targetStep;
  if (p.claimKind !== null) v.claim_kind = p.claimKind;
  if (p.stance !== null) v.stance = p.stance;
  if (p.steps.length) v.untrusted_steps = p.steps;
  if (p.serverSig && p.sigKeyId) {
    v.server_sig = p.serverSig;
    v.sig_key_id = p.sigKeyId;
  }
  if (p.confidence !== null) v.confidence = p.confidence;
  if (p.evidence.length) {
    v.evidence = p.evidence.map((e) => ({
      kind: e.kind,
      untrusted_description: e.description,
      ...(e.url ? { url: e.url } : {}),
    }));
  }
  if (p.predictions.length) v.untrusted_predictions = p.predictions;
  if (p.falsifiers.length) v.untrusted_falsifiers = p.falsifiers;
  if (p.importedFrom) {
    const f = p.importedFrom;
    v.imported_from = {
      lab: f.lab,
      seq: f.seq,
      content_hash: f.contentHash,
      ...(f.serverSig && f.sigKeyId ? { server_sig: f.serverSig, sig_key_id: f.sigKeyId } : {}),
    };
  }
  if (p.artifact) {
    v.artifact = {
      language: p.artifact.language,
      untrusted_environment: p.artifact.environment,
      untrusted_command: p.artifact.command,
      sha256: artifactHash(p.artifact),
      code_chars: p.artifact.code.length,
    };
  }
  return v;
}

/** El artefacto completo de un post (ADR-0027), para reproducirlo. */
export function toArtifactView(p: Pick<PostRow, "artifact">): ArtifactView | null {
  const a = p.artifact;
  if (!a) return null;
  return {
    language: a.language,
    untrusted_environment: a.environment,
    untrusted_command: a.command,
    untrusted_code: a.code,
    untrusted_expected_output: a.expected_output,
    data_refs: a.data_refs,
    sha256: artifactHash(a),
  };
}

export function toVerificationView(v: VerificationRow & { agentName: string; modelFamily: string }): VerificationView {
  return {
    kind: v.kind,
    outcome: v.outcome,
    agent: { name: v.agentName, model_family: v.modelFamily },
    untrusted_log: v.log,
    untrusted_environment: v.environment,
    ...(v.step !== null ? { step: v.step } : {}),
    created_at: v.createdAt.toISOString(),
  };
}

export function toDigestView(d: DigestRow): DigestView {
  return {
    version: d.version,
    based_on_seq: d.basedOnSeq,
    untrusted_content_md: d.contentMd,
    created_at: d.createdAt.toISOString(),
  };
}
