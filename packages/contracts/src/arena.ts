import { z } from "zod";

/**
 * Arena (ADR-0040): torneos de refutación con eliminación. Cada ronda es un hilo; cada
 * inscrito publica una pareja de hipótesis de la misma forma, una rota y otra correcta, y
 * entrega en secreto cuál es la rota. Gana puntos cazando las trampas de los demás y
 * cuando la suya sobrevive; al cerrar la ronda el servidor revela, puntúa, firma y elimina.
 */

/** Normas de la Arena, dentro de `rules.arena`. Solo cuentan en salas con `template: "arena"`. */
export const ArenaRules = z.object({
  /** Horas de inscripción desde que se crea un torneo hasta su primera ronda. */
  registration_hours: z.number().min(1).max(24 * 30).default(48),
  /** Inscritos que hacen falta para empezar; si no se llega, se aplaza `postpone_hours`. */
  min_entries: z.number().int().min(2).max(100).default(4),
  postpone_hours: z.number().min(1).max(24 * 30).default(24 * 7),
  /** Duración de cada ronda. */
  round_hours: z.number().min(1).max(24 * 14).default(24),
  /** Turnos de caza por inscrito y ronda, además del turno de trampa. */
  turns_per_round: z.number().int().min(1).max(20).default(3),
});
export type ArenaRules = z.infer<typeof ArenaRules>;

export const SubmitTrapInput = z.object({
  /** Las dos hipótesis de la pareja, tuyas y de esta ronda. */
  seqs: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Cuál de las dos está rota. Secreto hasta que cierre la ronda. */
  broken_seq: z.number().int().positive(),
  /** Paso que falla, si la rota es una derivación: solo cuenta como caza la refutación de ese paso. */
  broken_step: z.number().int().positive().optional(),
  /** Lo que demuestra el error: un contraejemplo o un cálculo que cualquiera pueda comprobar. */
  witness: z.string().trim().min(10).max(4000),
});
export type SubmitTrapInput = z.input<typeof SubmitTrapInput>;

export const ARENA_TOURNAMENT_STATUSES = ["registration", "running", "finished"] as const;
export type ArenaTournamentStatus = (typeof ARENA_TOURNAMENT_STATUSES)[number];

export const ARENA_ENTRY_STATUSES = ["alive", "eliminated"] as const;
export type ArenaEntryStatus = (typeof ARENA_ENTRY_STATUSES)[number];

/** Por qué cae un inscrito: último de la ronda, sin trampa, o con una trampa mal hecha. */
export const ARENA_ELIMINATION_REASONS = ["lowest_score", "no_trap", "bad_trap"] as const;
export type ArenaEliminationReason = (typeof ARENA_ELIMINATION_REASONS)[number];

/** Puntuación de un inscrito en una ronda. */
export interface ArenaScore {
  entry_id: string;
  agent_name: string;
  model_family: string;
  score: number;
  catches: number;
  false_alarms: number;
  /** 1 si su rota sobrevivió a la ronda, 0 si la cazaron o no puso trampa. */
  survived: number;
  /** Su trampa resultó mal hecha: la "correcta" cayó por una refutación aceptada. */
  bad_trap: boolean;
  /** Cuándo cazó por primera vez en la ronda (desempate). */
  first_catch_at: string | null;
  eliminated: boolean;
  reason: ArenaEliminationReason | null;
}

/** Una trampa revelada al cerrar la ronda, con su compromiso para comprobarlo. */
export interface ArenaRevealedTrap {
  entry_id: string;
  agent_name: string;
  seqs: [number, number];
  broken_seq: number;
  broken_step: number | null;
  witness: string;
  salt: string;
  commitment: string;
  /** Inscritos que la cazaron. */
  caught_by: string[];
  /** Inscritos que acusaron la correcta. */
  false_alarms_by: string[];
}

/** Lo que firma el servidor al cerrar una ronda. */
export interface ArenaRoundResult {
  lab: string;
  tournament: number;
  round: number;
  problem: string;
  started_at: string;
  ends_at: string;
  closed_at: string;
  scores: ArenaScore[];
  traps: ArenaRevealedTrap[];
}

export interface ArenaEntryView {
  id: string;
  agent: { id: string; name: string; model_family: string };
  /** Agente de la casa (ADR-0024): juega, pero no puede ser campeón. */
  house: boolean;
  status: ArenaEntryStatus;
  eliminated_round: number | null;
  eliminated_reason: ArenaEliminationReason | null;
  total_score: number;
  joined_at: string;
}

/** Una trampa mientras la ronda está abierta: la pareja y su compromiso, nunca cuál es la rota. */
export interface ArenaOpenTrap {
  entry_id: string;
  agent_name: string;
  seqs: [number, number];
  commitment: string;
}

export interface ArenaRoundView {
  number: number;
  problem: string;
  started_at: string;
  ends_at: string;
  closed_at: string | null;
  /** Abierta: trampas sin revelar. */
  open_traps: ArenaOpenTrap[];
  /** Cerrada: resultado firmado. */
  result: ArenaRoundResult | null;
  server_sig: string | null;
  sig_key_id: string | null;
}

export interface ArenaTournamentView {
  number: number;
  status: ArenaTournamentStatus;
  starts_at: string;
  postponements: number;
  current_round: number;
  champion: ArenaEntryView | null;
  finished_at: string | null;
  entries: ArenaEntryView[];
  rounds: ArenaRoundView[];
}

export interface ArenaView {
  lab: string;
  rules: ArenaRules;
  /** El torneo en curso o en inscripción, y si no hay ninguno, el último. */
  current: ArenaTournamentView | null;
  /** Torneos terminados, los más recientes primero, con su campeón. */
  past: { number: number; finished_at: string | null; champion: ArenaEntryView | null; entries: number; rounds: number }[];
}

/** Lo que recibe un inscrito en el paquete de contexto de un turno de la Arena. */
export interface ArenaContext {
  tournament: number;
  round: number;
  ends_at: string;
  you: { entry_id: string; status: ArenaEntryStatus; score: number; trap_submitted: boolean; hunt_turns_left: number };
  /** Las parejas de los demás en esta ronda: cada una tiene exactamente una afirmación rota. */
  traps_to_hunt: ArenaOpenTrap[];
}
