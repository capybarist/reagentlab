import type {
  ClaimStatus,
  LabRules,
  StepCheck,
  VerificationKind,
  VerificationMethod,
  VerificationOutcome,
} from "@reagentlab/contracts";

/**
 * Verificaciones (ADR-0027), funciones puras. Un claim se verifica reproduciendo su
 * artefacto (cálculos) o revisando sus pasos (derivaciones); un claim adoptado pasa a
 * verde cuando las confirmaciones netas de partes distintas llegan a lo que pide la sala.
 */

/** Qué se verifica de un claim, o null si no hay nada que verificar o la sala no lo usa. */
export function verificationKindOf(
  claim: { kind: string; hasArtifact: boolean },
  rules: Pick<LabRules, "min_reproductions" | "min_derivation_checks">,
): VerificationKind | null {
  if (claim.kind === "computation" && claim.hasArtifact && rules.min_reproductions > 0) return "artifact";
  if (claim.kind === "derivation" && rules.min_derivation_checks > 0) return "derivation";
  return null;
}

export function requiredFor(kind: VerificationKind, rules: Pick<LabRules, "min_reproductions" | "min_derivation_checks">) {
  return kind === "artifact" ? rules.min_reproductions : rules.min_derivation_checks;
}

/** Estados en los que un claim admite verificaciones: vivo y con algo que comprobar. */
const VERIFIABLE_STATUSES: readonly ClaimStatus[] = ["open", "supported", "adopted"];

export type VerificationBlock = "not_verifiable" | "closed" | "conflict_of_interest" | "already_verified";

/**
 * ¿Puede esta parte verificar el claim? Nunca la del autor, y cada parte una sola vez.
 * Un claim ya verde no necesita más; uno refutado ya no se verifica.
 */
export function verificationBlock(
  claim: { status: ClaimStatus; authorParty: string; kind: VerificationKind | null },
  party: string,
  partiesThatVerified: readonly string[],
): VerificationBlock | null {
  if (!claim.kind) return "not_verifiable";
  if (!VERIFIABLE_STATUSES.includes(claim.status)) return "closed";
  if (party === claim.authorParty) return "conflict_of_interest";
  if (partiesThatVerified.includes(party)) return "already_verified";
  return null;
}

export interface Tally {
  confirms: number;
  fails: number;
  inconclusive: number;
}

/** Recuento por parte: cada parte cuenta una vez (la base de datos ya no deja repetir). */
export function tally(verifications: readonly { party: string; outcome: VerificationOutcome }[]): Tally {
  const byParty = new Map<string, VerificationOutcome>();
  for (const v of verifications) if (!byParty.has(v.party)) byParty.set(v.party, v.outcome);
  const t: Tally = { confirms: 0, fails: 0, inconclusive: 0 };
  for (const o of byParty.values()) {
    if (o === "confirms") t.confirms++;
    else if (o === "fails") t.fails++;
    else t.inconclusive++;
  }
  return t;
}

/**
 * ¿Pasa a verde? Un claim apoyado o adoptado (ADR-0044: la comprobación va antes que el poll),
 * sin ninguna refutación abierta, y con confirmaciones netas suficientes: un fallo de otra
 * parte resta una confirmación, así que un solo verificador no bloquea para siempre, pero
 * tampoco se ignora. Mientras alguien lo ataca, espera al dictamen.
 */
export function readyForGreen(status: ClaimStatus, t: Tally, required: number, hasOpenRefutation = false): boolean {
  if (status !== "supported" && status !== "adopted") return false;
  if (hasOpenRefutation) return false;
  return required > 0 && t.confirms - t.fails >= required;
}

export interface StepsProblem {
  message: string;
  hint: string;
}

/**
 * Normaliza y valida lo que dice una verificación de sus pasos (ADR-0031). En una derivación,
 * `confirms` exige haber leído todos los pasos y que todos se sostengan, y un `rerun` solo no
 * confirma nada: el enunciado puede valer en el rango probado con un paso roto. `fails` exige
 * el paso que falla (en `steps_checked` o, como antes, en `step`). En un artefacto no hay pasos.
 */
export function checkSteps(
  kind: VerificationKind,
  input: { outcome: VerificationOutcome; method?: VerificationMethod; step?: number; steps_checked?: StepCheck[] },
  stepCount: number,
): { method: VerificationMethod; step: number | null; steps: StepCheck[] | null } | StepsProblem {
  if (kind === "artifact") {
    if (input.steps_checked?.length || input.step !== undefined) {
      return { message: "steps_checked y step solo valen para derivaciones.", hint: "Quítalos al verificar un artefacto." };
    }
    return { method: input.method ?? "rerun", step: null, steps: null };
  }

  const method = input.method ?? "read";
  const steps = new Map<number, StepCheck>();
  for (const c of input.steps_checked ?? []) {
    if (c.step > stepCount) {
      return { message: `La derivación tiene ${stepCount} pasos: step va de 1 a ${stepCount}.`, hint: "Revisa los números de paso." };
    }
    if (steps.has(c.step)) return { message: `El paso ${c.step} aparece dos veces en steps_checked.`, hint: "Uno por paso." };
    steps.set(c.step, c);
  }
  if (input.step !== undefined) {
    if (input.step > stepCount) {
      return { message: `La derivación tiene ${stepCount} pasos: step va de 1 a ${stepCount}.`, hint: "Revisa el número de paso." };
    }
    const listed = steps.get(input.step);
    if (listed && listed.verdict !== "fails") {
      return { message: `step dice que falla el paso ${input.step}, pero steps_checked dice "${listed.verdict}".`, hint: "Que coincidan." };
    }
    if (!listed) steps.set(input.step, { step: input.step, verdict: "fails" });
  }
  const sorted = [...steps.values()].sort((a, b) => a.step - b.step);
  const failing = sorted.find((c) => c.verdict === "fails");

  if (input.outcome === "confirms") {
    if (method === "rerun") {
      return {
        message: "Volver a ejecutar el enunciado no comprueba la derivación: puede valer en el rango probado con un paso roto.",
        hint: "Lee los pasos (method 'read' o 'both') y di en steps_checked qué encontraste en cada uno, o publica el re-run como evidencia.",
      };
    }
    const missing = Array.from({ length: stepCount }, (_, i) => i + 1).filter((n) => steps.get(n)?.verdict !== "holds");
    if (missing.length) {
      return {
        message: `Para confirmar una derivación, todos sus pasos tienen que estar revisados y sostenerse; faltan o no se sostienen: ${missing.join(", ")}.`,
        hint: 'Manda steps_checked con {step, verdict: "holds"} para cada paso, o usa "fails" o "inconclusive".',
      };
    }
  }
  if (input.outcome === "fails" && !failing) {
    return {
      message: "Una verificación que falla tiene que decir qué paso no se sigue.",
      hint: 'Marca ese paso con verdict "fails" en steps_checked (o pon su número en step).',
    };
  }
  if (input.outcome !== "fails" && failing) {
    return { message: `El paso ${failing.step} falla, así que el resultado es "fails".`, hint: 'Usa outcome "fails".' };
  }
  return { method, step: failing?.step ?? null, steps: sorted.length ? sorted : null };
}

/** Por paso, cuántas partes dicen que se sostiene y cuántas que falla (ADR-0031). */
export function stepCoverage(
  stepCount: number,
  verifications: readonly { party: string; steps: StepCheck[] | null }[],
): { holds: number; fails: number }[] {
  const out = Array.from({ length: stepCount }, () => ({ holds: 0, fails: 0 }));
  const seen = new Set<string>();
  for (const v of verifications) {
    if (seen.has(v.party)) continue;
    seen.add(v.party);
    for (const c of v.steps ?? []) {
      const slot = out[c.step - 1];
      if (!slot) continue;
      if (c.verdict === "holds") slot.holds++;
      else if (c.verdict === "fails") slot.fails++;
    }
  }
  return out;
}
