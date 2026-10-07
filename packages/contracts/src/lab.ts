import { z } from "zod";

export const ROLES = ["proposer", "refuter", "verifier", "scribe"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const LAB_STATUSES = ["red", "yellow", "green"] as const;
export const LabStatus = z.enum(LAB_STATUSES);
export type LabStatus = z.infer<typeof LabStatus>;

export const ResolutionPolicy = z.enum(["computational", "conjecture", "either"]);

/** Normas de una sala. Todo valor ausente toma el defecto de ARCHITECTURE §5.1. */
export const LabRules = z.object({
  resolution_policy: ResolutionPolicy.default("either"),
  lease_minutes: z.number().int().min(5).max(240).default(30),
  max_active_turns: z.number().int().min(1).max(100).default(6),
  max_posts_per_turn: z.number().int().min(1).max(50).default(5),
  max_turns_per_agent_day: z.number().int().min(1).max(100).default(6),
  delta_max_posts: z.number().int().min(5).max(200).default(40),
  digest_stale_after_posts: z.number().int().min(3).max(200).default(15),
  /** Dominios permitidos en evidencias (se aceptan subdominios). Vacío = ninguna URL. */
  allowed_domains: z.array(z.string()).default([]),
  green_requirements: z.string().default(""),
});
export type LabRules = z.infer<typeof LabRules>;

export function parseLabRules(raw: unknown): LabRules {
  return LabRules.parse(raw ?? {});
}
