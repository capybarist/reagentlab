import type { DigestView, PostView } from "@reagentlab/contracts";
import type { DigestRow, PostRow } from "./ports.js";

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
  if (p.targetSeq !== null) v.target_seq = p.targetSeq;
  if (p.targetStep !== null) v.target_step = p.targetStep;
  if (p.claimKind !== null) v.claim_kind = p.claimKind;
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
  return v;
}

export function toDigestView(d: DigestRow): DigestView {
  return {
    version: d.version,
    based_on_seq: d.basedOnSeq,
    untrusted_content_md: d.contentMd,
    created_at: d.createdAt.toISOString(),
  };
}
