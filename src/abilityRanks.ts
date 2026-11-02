/**
 * Rangos de habilidad (mismas reglas que src/data/abilityRanks.ts).
 * - Cada nivel de personaje da 1 punto.
 * - Q/W/E (H1/H2/H3): rango 0–5, gastan puntos.
 * - Definitiva (R): rango 0–3, gasta puntos y solo se desbloquea un rango en los niveles 6, 11 y 16.
 * - Pasiva y auto-ataques: no gastan puntos; 4 rangos automáticos por nivel (1 / 6 / 11 / 16).
 */
export const RANKED_SLOTS = ['H1', 'H2', 'H3', 'R'] as const;
export type RankedSlot = (typeof RANKED_SLOTS)[number];
export type AbilityRanks = Record<RankedSlot, number>;

export const BASIC_MAX_RANK = 5;
export const ULT_MAX_RANK = 3;
export const ULT_LEVELS = [6, 11, 16] as const;
/** Umbrales de la pasiva y los auto-ataques: rango 1 desde nivel 1, 2 desde 6, 3 desde 11, 4 desde 16. */
export const MILESTONE_LEVELS = [1, 6, 11, 16] as const;
export const MILESTONE_RANKS = MILESTONE_LEVELS.length;

export const EMPTY_RANKS: AbilityRanks = { H1: 0, H2: 0, H3: 0, R: 0 };

export function maxRank(slot: RankedSlot): number {
  return slot === 'R' ? ULT_MAX_RANK : BASIC_MAX_RANK;
}

/** Rangos de definitiva desbloqueados a este nivel. */
export function ultRankCap(level: number): number {
  return ULT_LEVELS.filter(threshold => level >= threshold).length;
}

/** Rango automático de pasiva/auto-ataques (1–4). */
export function milestoneRank(level: number): number {
  return Math.max(1, MILESTONE_LEVELS.filter(threshold => level >= threshold).length);
}

export function totalPoints(level: number): number {
  return Math.max(0, Math.floor(level));
}

export function spentPoints(ranks: AbilityRanks): number {
  return RANKED_SLOTS.reduce((sum, slot) => sum + ranks[slot], 0);
}

function toRank(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Rangos válidos para el nivel: recorta la R a lo desbloqueado y, si sobran puntos gastados
 * (p. ej. al bajar de nivel), quita de la básica más alta (E, W, Q) y, si no quedan, de la R.
 */
export function normalizeRanks(value: unknown, level: number): AbilityRanks {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ranks: AbilityRanks = { ...EMPTY_RANKS };
  for (const slot of RANKED_SLOTS) ranks[slot] = Math.min(toRank(source[slot]), maxRank(slot));
  ranks.R = Math.min(ranks.R, ultRankCap(level));
  let excess = spentPoints(ranks) - totalPoints(level);
  while (excess > 0) {
    const highest = (['H3', 'H2', 'H1'] as const).reduce((best, slot) => (ranks[slot] > ranks[best] ? slot : best), 'H3' as RankedSlot);
    if (ranks[highest] > 0) ranks[highest]--;
    else if (ranks.R > 0) ranks.R--;
    else break;
    excess--;
  }
  return ranks;
}

export function unassignedPoints(ranks: AbilityRanks, level: number): number {
  return Math.max(0, totalPoints(level) - spentPoints(ranks));
}

/** Se puede subir si quedan puntos, no está al máximo y (R) el nivel lo desbloquea. */
export function canRaise(ranks: AbilityRanks, slot: RankedSlot, level: number): boolean {
  if (unassignedPoints(ranks, level) <= 0) return false;
  const cap = slot === 'R' ? Math.min(ULT_MAX_RANK, ultRankCap(level)) : BASIC_MAX_RANK;
  return ranks[slot] < cap;
}

export function canLower(ranks: AbilityRanks, slot: RankedSlot): boolean {
  return ranks[slot] > 0;
}

/** Escalado del rango actual (rango 1 = índice 0). Si la lista es más corta, usa el último valor. Rango 0 → 0. */
export function scalingAtRank(scaling: number[] | undefined, rank: number): number {
  if (!scaling?.length || rank <= 0) return 0;
  return scaling[Math.min(rank, scaling.length) - 1] ?? 0;
}
