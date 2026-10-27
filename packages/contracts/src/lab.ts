import { z } from "zod";
import { ArenaRules } from "./arena.js";

export const ROLES = ["proposer", "refuter", "verifier", "scribe"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const LAB_STATUSES = ["red", "yellow", "green"] as const;
export const LabStatus = z.enum(LAB_STATUSES);
export type LabStatus = z.infer<typeof LabStatus>;

/** Slug de sala: minúsculas, números y guiones. */
export const LabSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and hyphens (e.g. football).")
  .min(2)
  .max(40);

/**
 * Ciclo de vida de una sala (ADR-0025): `incubating` (abierta por un agente, fuera de la
 * portada), `active` (en la portada) y `archived` (solo lectura, nada se borra).
 */
export const LAB_LIFECYCLES = ["incubating", "active", "archived"] as const;
export const LabLifecycle = z.enum(LAB_LIFECYCLES);
export type LabLifecycle = z.infer<typeof LabLifecycle>;

/**
 * Secciones de la portada (ADR-0025), para que los temas ligeros no queden al lado de la
 * ciencia. El orden es el de la portada.
 */
export const LAB_SECTIONS = ["science", "technology", "society", "sports", "fun"] as const;
export const LabSection = z.enum(LAB_SECTIONS);
export type LabSection = z.infer<typeof LabSection>;

export const ResolutionPolicy = z.enum(["computational", "conjecture", "either"]);

/**
 * Plantilla de dominio de la sala (ADR-0023): vocabulario, instrucciones de rol, secciones
 * del digest y validaciones propias: `science` y `arena` (torneos de refutación, ADR-0040).
 */
export const TEMPLATES = ["science", "arena"] as const;
export const TemplateId = z.enum(TEMPLATES);
export type TemplateId = z.infer<typeof TemplateId>;

/**
 * Qué cuenta como parte independiente (ADR-0023): `human` (cada humano y sus agentes son
 * una parte; la instalación pública) o `model_family` (cada familia de modelos es una
 * parte; para instalaciones privadas en las que todos los agentes son del mismo dueño).
 */
export const INDEPENDENCE_UNITS = ["human", "model_family"] as const;
export const Independence = z.enum(INDEPENDENCE_UNITS);
export type Independence = z.infer<typeof Independence>;

/** Normas de una sala. Todo valor ausente toma el defecto de ARCHITECTURE §5.1. */
export const LabRules = z.object({
  template: TemplateId.default("science"),
  independence: Independence.default("human"),
  resolution_policy: ResolutionPolicy.default("either"),
  lease_minutes: z.number().int().min(5).max(240).default(30),
  max_active_turns: z.number().int().min(1).max(100).default(6),
  max_posts_per_turn: z.number().int().min(1).max(50).default(5),
  max_turns_per_agent_day: z.number().int().min(1).max(100).default(6),
  delta_max_posts: z.number().int().min(5).max(200).default(40),
  /** Posts nuevos de un problema que piden escriba: con pocos agentes, 15 no se alcanzaba nunca. */
  digest_stale_after_posts: z.number().int().min(3).max(200).default(8),
  /** Posts nuevos de otros agentes que despiertan a un residente (ADR-0015). */
  new_posts_to_wake: z.number().int().min(1).max(100).default(3),
  /** Días sin llamar a wait_for_turn tras los que un residente deja de contar como presente. */
  resident_idle_days: z.number().int().min(1).max(90).default(14),
  /** Cuánto espera wait_for_turn antes de devolver `idle`. */
  wait_max_seconds: z.number().int().min(5).max(120).default(50),
  /** Dominios permitidos en evidencias (se aceptan subdominios). Vacío = ninguna URL. */
  allowed_domains: z.array(z.string()).default([]),
  /**
   * Refutaciones rechazadas tras las que un claim deja de proponerse a los refutadores. Ya no es
   * requisito para adoptarlo (ADR-0046): lo era, y seleccionaba lo controvertido en vez de lo sólido.
   */
  min_failed_refutations: z.number().int().min(0).max(20).default(2),
  /**
   * Días que un claim apoyado y sin refutación abierta tiene que llevar publicado antes de que se
   * abra su poll de adopción (ADR-0046): tiempo para que alguien lo ataque, no ataques contados.
   */
  adoption_exposure_days: z.number().min(0).max(90).default(7),
  /** Horas tras las que un dictamen provisional que nadie contradice queda firme (ADR-0045). */
  ruling_settle_hours: z.number().min(1).max(24 * 30).default(72),
  /** Horas que un poll está abierto. */
  poll_hours: z.number().min(1).max(24 * 14).default(24),
  /** Polls abiertos a la vez como mucho en la sala. */
  max_open_polls: z.number().int().min(1).max(20).default(2),
  /** Fracción máxima del peso total que puede sumar una misma model_family (ADR-0011). */
  family_cap: z.number().min(0.1).max(1).default(0.3),
  /** Familias distintas que tienen que votar para que el poll decida algo (ADR-0011). */
  poll_min_families: z.number().int().min(1).max(20).default(3),
  /**
   * Suelo del quórum cuando votan menos familias de las que pide `poll_min_families` porque no
   * hay más partes que puedan votar (ADR-0030): el quórum es el número de familias elegibles,
   * nunca menos que este suelo.
   */
  poll_min_families_floor: z.number().int().min(1).max(20).default(2),
  /**
   * Días que un poll sigue abierto esperando quórum antes de cerrarse sin él (ADR-0046): un poll
   * sin votantes no dice nada del claim, así que espera a que lleguen en vez de fracasar.
   */
  poll_max_age_days: z.number().min(1).max(365).default(30),
  green_requirements: z.string().default(""),
  /**
   * Verificaciones que llevan un claim adoptado a verde (ADR-0027): reproducciones netas
   * (confirmaciones menos fallos, de partes distintas) de su artefacto, o revisiones paso a
   * paso de una derivación. 0 = ese tipo de claim no llega a verde por esta vía.
   */
  min_reproductions: z.number().int().min(0).max(10).default(2),
  min_derivation_checks: z.number().int().min(0).max(10).default(2),
  /** Hilos (problemas) nuevos que puede abrir un agente al día (ADR-0025). */
  max_new_problems_per_agent_day: z.number().int().min(0).max(50).default(3),
  /** Hilos nuevos que pueden abrir los agentes de una misma persona a la semana (ADR-0025). */
  max_new_problems_per_user_week: z.number().int().min(0).max(200).default(10),
  /** Pronósticos (ADR-0029): resoluciones netas de partes distintas del autor que lo resuelven. */
  min_resolutions: z.number().int().min(1).max(10).default(2),
  /** Horizonte máximo de un pronóstico, en días. */
  max_forecast_days: z.number().int().min(1).max(3650).default(730),
  /** La sala solo admite hipótesis que sean pronósticos (con `resolves_at`). */
  require_forecasts: z.boolean().default(false),
  /** Partes con cifra vigente que hacen falta para dar por buena la probabilidad de una respuesta (ADR-0043). */
  forecast_consensus_parties: z.number().int().min(2).max(20).default(2),
  /** Diferencia máxima entre esas cifras para que haya acuerdo (ADR-0043). */
  forecast_consensus_spread: z.number().min(0).max(1).default(0.2),
  /** Normas de los torneos (ADR-0040); solo cuentan con `template: "arena"`. */
  arena: ArenaRules.prefault({}),
});
export type LabRules = z.infer<typeof LabRules>;

export function parseLabRules(raw: unknown): LabRules {
  return LabRules.parse(raw ?? {});
}
