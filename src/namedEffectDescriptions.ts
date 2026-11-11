import { HttpError } from './errors';
import { getDb } from './db';
import { SHEET_STAT_KEYS } from './validate';

/**
 * Datos que el admin escribe para los efectos con nombre (Mongo: namedEffectDescriptions).
 * Un documento por efecto o variante: { _id: 'spellblade' | 'spellblade:magic', description?, onHit?, updatedAt }.
 * - description: texto libre.
 * - onHit: «Al impactar». En una variante, si no está, hereda el del efecto base (por eso en variantes
 *   se guarda también false). En un efecto base, false = no se guarda.
 * - bonus: configurador de bonus (reglas en combate, CD, duración). En una variante, si no está, usa la del base.
 * Sin descripción, sin onHit y sin bonus = se borra el documento.
 */
type DescriptionDoc = { _id: string; description?: string; onHit?: boolean; bonus?: EffectBonusConfig; updatedAt: string };

// ── Configurador de bonus (mismo modelo que web/src/data/effectBonus.ts) ──
const TRIGGERS = ['always', 'on-hit', 'after-ability', 'on-ability-hit', 'on-use', 'on-takedown', 'hp-below', 'on-damage-taken', 'on-attacked', 'each-turn'] as const;
const KINDS = ['stat', 'damage', 'heal', 'shield', 'mana', 'slow', 'status', 'extra-on-hit', 'attack-speed', 'move-speed'] as const;
const SCALING = ['baseAd', 'ad', 'bonusAd', 'ap', 'hp', 'bonusHp', 'mana', 'bonusMana', 'armor', 'bonusArmor', 'mr', 'bonusMr', 'critChance', 'manaRegen', 'level', 'targetMaxHp', 'targetCurrentHp', 'targetMissingHp', 'targetArmor', 'targetMr'] as const;
const DAMAGE_TYPES = ['physical', 'magic', 'true'] as const;
const MAX_RULES = 12;

export type EffectRule = {
  trigger: (typeof TRIGGERS)[number];
  kind: (typeof KINDS)[number];
  /** self: al portador; target: a los objetivos golpeados (debuffs de stat, estados). */
  appliesTo?: 'self' | 'target';
  stat?: string;
  flat?: number;
  ratios?: { stat: (typeof SCALING)[number]; pct: number }[];
  perLevel?: number[];
  damageType?: (typeof DAMAGE_TYPES)[number];
  slowPct?: number;
  statusName?: string;
  count?: number;
  hpBelowPct?: number;
  duration?: number;
  maxStacks?: number;
  note?: string;
};

export type EffectBonusConfig = { cooldown?: number; duration?: number; cdStart?: 'on-activate' | 'on-end'; rules: EffectRule[] };

const oneOf = <T extends string>(list: readonly T[], value: unknown, field: string): T => {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new HttpError(400, `${field} no es válido`);
};
const optNumber = (value: unknown, field: string, min: number, max: number): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new HttpError(400, `${field} tiene que ser un número entre ${min} y ${max}`);
  return value;
};
const optTurns = (value: unknown, field: string): number | undefined => {
  const n = optNumber(value, field, 1, 99);
  if (n !== undefined && !Number.isInteger(n)) throw new HttpError(400, `${field} tiene que ser un entero`);
  return n;
};
const optText = (value: unknown, field: string, max: number): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser texto`);
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, `${field}: máximo ${max} caracteres`);
  return text || undefined;
};

export function parseEffectBonusConfig(value: unknown): EffectBonusConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'bonus tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.rules)) throw new HttpError(400, 'bonus.rules tiene que ser una lista');
  if (source.rules.length > MAX_RULES) throw new HttpError(400, `Máximo ${MAX_RULES} reglas por efecto`);
  const rules = source.rules.map((entry, index): EffectRule => {
    const field = `bonus.rules[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpError(400, `${field} tiene que ser un objeto`);
    const r = entry as Record<string, unknown>;
    const rule: EffectRule = { trigger: oneOf(TRIGGERS, r.trigger, `${field}.trigger`), kind: oneOf(KINDS, r.kind, `${field}.kind`) };
    if (r.appliesTo !== undefined && r.appliesTo !== null) {
      const appliesTo = oneOf(['self', 'target'] as const, r.appliesTo, `${field}.appliesTo`);
      if (appliesTo === 'target') rule.appliesTo = appliesTo;
    }
    if (r.stat !== undefined && r.stat !== null) rule.stat = oneOf(SHEET_STAT_KEYS, r.stat, `${field}.stat`);
    if (rule.kind === 'stat' && !rule.stat) throw new HttpError(400, `${field}.stat es obligatoria en un bonus de stat`);
    const flat = optNumber(r.flat, `${field}.flat`, -9999, 9999);
    if (flat !== undefined) rule.flat = flat;
    if (r.ratios !== undefined && r.ratios !== null) {
      if (!Array.isArray(r.ratios) || r.ratios.length > 6) throw new HttpError(400, `${field}.ratios: lista de hasta 6`);
      rule.ratios = r.ratios.map((ratio, i) => {
        if (!ratio || typeof ratio !== 'object') throw new HttpError(400, `${field}.ratios[${i}] no es válido`);
        const x = ratio as Record<string, unknown>;
        return { stat: oneOf(SCALING, x.stat, `${field}.ratios[${i}].stat`), pct: optNumber(x.pct, `${field}.ratios[${i}].pct`, -1000, 1000) ?? 0 };
      });
    }
    if (r.perLevel !== undefined && r.perLevel !== null) {
      if (!Array.isArray(r.perLevel) || r.perLevel.length > 20) throw new HttpError(400, `${field}.perLevel: hasta 20 valores`);
      rule.perLevel = r.perLevel.map((n, i) => optNumber(n, `${field}.perLevel[${i}]`, -9999, 9999) ?? 0);
    }
    if (r.damageType !== undefined && r.damageType !== null) rule.damageType = oneOf(DAMAGE_TYPES, r.damageType, `${field}.damageType`);
    const slowPct = optNumber(r.slowPct, `${field}.slowPct`, 0, 100);
    if (slowPct !== undefined) rule.slowPct = slowPct;
    const statusName = optText(r.statusName, `${field}.statusName`, 40);
    if (statusName) rule.statusName = statusName;
    const count = optTurns(r.count, `${field}.count`);
    if (count) rule.count = count;
    const hpBelowPct = optNumber(r.hpBelowPct, `${field}.hpBelowPct`, 0, 100);
    if (hpBelowPct !== undefined) rule.hpBelowPct = hpBelowPct;
    const duration = optTurns(r.duration, `${field}.duration`);
    if (duration) rule.duration = duration;
    const maxStacks = optTurns(r.maxStacks, `${field}.maxStacks`);
    if (maxStacks) rule.maxStacks = maxStacks;
    const note = optText(r.note, `${field}.note`, 120);
    if (note) rule.note = note;
    return rule;
  });
  const config: EffectBonusConfig = { rules };
  const cooldown = optTurns(source.cooldown, 'bonus.cooldown');
  if (cooldown) config.cooldown = cooldown;
  const duration = optTurns(source.duration, 'bonus.duration');
  if (duration) config.duration = duration;
  if (source.cdStart !== undefined && source.cdStart !== null) config.cdStart = oneOf(['on-activate', 'on-end'] as const, source.cdStart, 'bonus.cdStart');
  return config;
}

export const NAMED_EFFECT_DESCRIPTION_MAX = 2000;
const EFFECT_ID = /^[a-z0-9-]{1,60}(:[a-z0-9-]{1,30})?$/;

async function descriptions() {
  return (await getDb()).collection<DescriptionDoc>('namedEffectDescriptions');
}

export type NamedEffectDescriptions = {
  /** { id: descripción } */
  descriptions: Record<string, string>;
  /** { id: true/false } solo de los que tienen valor propio. */
  onHit: Record<string, boolean>;
  /** { id: config } solo de los que tienen config propia. */
  bonus: Record<string, EffectBonusConfig>;
};

export async function listNamedEffectDescriptions(): Promise<NamedEffectDescriptions> {
  const docs = await (await descriptions()).find({}).toArray();
  const result: NamedEffectDescriptions = { descriptions: {}, onHit: {}, bonus: {} };
  for (const doc of docs) {
    if (typeof doc.description === 'string' && doc.description) result.descriptions[doc._id] = doc.description;
    if (typeof doc.onHit === 'boolean') result.onHit[doc._id] = doc.onHit;
    if (doc.bonus && typeof doc.bonus === 'object') result.bonus[doc._id] = doc.bonus;
  }
  return result;
}

export type NamedEffectDescriptionPatch = {
  id: string;
  /** undefined = no se toca; '' = se borra. */
  description?: string;
  /** undefined = no se toca; null = se quita (la variante vuelve a heredar). */
  onHit?: boolean | null;
  /** undefined = no se toca; null = se quita (la variante vuelve a usar la del base). */
  bonus?: EffectBonusConfig | null;
};

export function parseNamedEffectDescriptionPatch(body: unknown): NamedEffectDescriptionPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Cuerpo no válido');
  const source = body as Record<string, unknown>;
  if (typeof source.id !== 'string' || !EFFECT_ID.test(source.id)) throw new HttpError(400, 'Efecto no válido');
  const patch: NamedEffectDescriptionPatch = { id: source.id };
  if ('description' in source) {
    if (source.description !== null && typeof source.description !== 'string') throw new HttpError(400, 'La descripción tiene que ser texto');
    const description = (source.description ?? '').replace(/\r\n/g, '\n').trim();
    if (description.length > NAMED_EFFECT_DESCRIPTION_MAX) {
      throw new HttpError(400, `Máximo ${NAMED_EFFECT_DESCRIPTION_MAX} caracteres por descripción`);
    }
    patch.description = description;
  }
  if ('onHit' in source) {
    if (source.onHit !== null && typeof source.onHit !== 'boolean') throw new HttpError(400, 'onHit tiene que ser true, false o null');
    // En un efecto base false es lo mismo que no tenerlo.
    patch.onHit = source.onHit === false && !source.id.includes(':') ? null : (source.onHit as boolean | null);
  }
  if ('bonus' in source) patch.bonus = source.bonus === null ? null : parseEffectBonusConfig(source.bonus);
  if (patch.description === undefined && patch.onHit === undefined && patch.bonus === undefined) {
    throw new HttpError(400, 'Nada que guardar (description, onHit o bonus)');
  }
  return patch;
}

export async function setNamedEffectDescription(patch: NamedEffectDescriptionPatch): Promise<{ id: string; description: string; onHit: boolean | null; bonus: EffectBonusConfig | null }> {
  const col = await descriptions();
  const set: Partial<DescriptionDoc> = { updatedAt: new Date().toISOString() };
  const unset: Record<string, ''> = {};
  if (patch.description !== undefined) {
    if (patch.description) set.description = patch.description;
    else unset.description = '';
  }
  if (patch.onHit !== undefined) {
    if (patch.onHit === null) unset.onHit = '';
    else set.onHit = patch.onHit;
  }
  if (patch.bonus !== undefined) {
    if (patch.bonus === null) unset.bonus = '';
    else set.bonus = patch.bonus;
  }
  await col.updateOne(
    { _id: patch.id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { upsert: true },
  );
  // Se borra solo si ya no queda nada (ni descripción, ni onHit, ni bonus).
  await col.deleteOne({ _id: patch.id, description: { $exists: false }, onHit: { $exists: false }, bonus: { $exists: false } });
  const doc = await col.findOne({ _id: patch.id });
  return {
    id: patch.id,
    description: typeof doc?.description === 'string' ? doc.description : '',
    onHit: typeof doc?.onHit === 'boolean' ? doc.onHit : null,
    bonus: doc?.bonus ?? null,
  };
}
