import { HttpError } from './errors';
import { parseAreaPattern, type AreaPattern } from './areaPattern';
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
type DescriptionDoc = { _id: string; description?: string; onHit?: boolean; bonus?: EffectBonusConfig; area?: AreaPattern; updatedAt: string };

// ── Configurador de bonus (mismo modelo que web/src/data/effectBonus.ts) ──
const TRIGGERS = ['always', 'on-hit', 'on-attack', 'after-ability', 'after-use', 'on-ability-hit', 'on-use', 'on-takedown', 'hp-below', 'on-damage-taken', 'on-attacked', 'each-turn', 'energized-max', 'on-ultimate-use'] as const;
const KINDS = ['stat', 'damage', 'heal', 'shield', 'mana', 'slow', 'status', 'extra-on-hit', 'attack-speed', 'move-speed', 'vigor', 'damage-reduction', 'execute', 'extra-action'] as const;
const SCALING = ['baseAd', 'ad', 'bonusAd', 'ap', 'hp', 'bonusHp', 'missingHp', 'mana', 'bonusMana', 'armor', 'bonusArmor', 'mr', 'bonusMr', 'critChance', 'manaRegen', 'level', 'spe', 'targetMaxHp', 'targetCurrentHp', 'targetMissingHp', 'targetArmor', 'targetMr', 'targetSpe', 'lethality'] as const;
const DAMAGE_TYPES = ['physical', 'magic', 'true'] as const;
const MAX_RULES = 12;

export type EffectRule = {
  trigger: (typeof TRIGGERS)[number];
  kind: (typeof KINDS)[number];
  /** self: al portador; target: a los objetivos golpeados (debuffs de stat, estados). */
  appliesTo?: 'self' | 'target' | 'area' | 'nearby' | 'allies';
  /** perLevel con el nivel de cada objetivo. */
  levelFrom?: 'target';
  /** Daño: cura al portador daño × su robo de vida %. */
  lifeSteal?: boolean;
  stat?: string;
  flat?: number;
  ratios?: { stat: (typeof SCALING)[number]; pct: number }[];
  perLevel?: number[];
  damageType?: (typeof DAMAGE_TYPES)[number];
  slowPct?: number;
  statusName?: string;
  count?: number;
  hpBelowPct?: number;
  targetHpBelowPct?: number;
  healFromDealtPct?: number;
  fromDamagePct?: number;
  vs?: 'aa' | 'all';
  action?: string;
  dice?: string;
  everyN?: number;
  perTargetCounter?: boolean;
  missingHpScalePct?: number;
  triggerAtMax?: boolean;
  requiresMaxStacks?: boolean;
  delayTurns?: number;
  halfAfterTurns?: number;
  fromManaSpentPct?: number;
  critPotencyPct?: number;
  pulseEachTurn?: boolean;
  spellShield?: boolean;
  cooldownOnProc?: boolean;
  unseenTurns?: number;
  armedTurnsAfterSeen?: number;
  auraRange?: number;
  damageAmpPct?: number;
  duration?: number;
  maxStacks?: number;
  /** Bonus de stat permanente (sin turnos en combate). */
  permanent?: boolean;
  /** Solo si el portador es cuerpo a cuerpo (rango total ≤ 1, el 0 cuenta) o a distancia (rango > 1); ausente = siempre. */
  onlyIf?: 'melee' | 'ranged';
  note?: string;
};

export type EffectBonusConfig = {
  cooldown?: number;
  /** CD por tramo de nivel del portador (1–5 / 6–10 / 11–15 / 16–20). */
  cooldownByLevel?: number[];
  duration?: number;
  cdStart?: 'on-activate' | 'on-end';
  /** Vigor: las habilidades que golpean también descargan el Vigor al máximo (Espada ciclovoltaica). */
  abilityDischarge?: boolean;
  /** Vigor al máximo: encadena a N objetivos (1-10; ausente = 1). */
  chainTargets?: number;
  /** Enfriamiento por objetivo: el CD va en cada objetivo (marca por portador), no en el portador (Firmamento desgarrado). */
  perTargetCooldown?: boolean;
  /** Al usar: máximo de objetivos enemigos (1-20). */
  maxTargets?: number;
  /** Cargas de combate: empieza con start (0-max), máx. max (1-99), recarga 1 cada every turnos (1-99). */
  charges?: { start: number; max: number; every: number; perTurn?: boolean };
  oncePerCombat?: boolean;
  rules: EffectRule[];
};

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

type AppliesTo = NonNullable<EffectRule['appliesTo']>;
const DEBUFF_TO: AppliesTo[] = ['target', 'area', 'nearby'];
/** A quién puede ir cada tipo de regla (mismo criterio que web/src/data/effectBonus.ts appliesToOptions). */
const APPLIES_TO_BY_KIND: Record<EffectRule['kind'], AppliesTo[]> = {
  stat: ['self', 'allies', ...DEBUFF_TO],
  'attack-speed': ['self', 'allies', ...DEBUFF_TO],
  'move-speed': ['self', 'allies', ...DEBUFF_TO],
  heal: ['self', 'allies'],
  shield: ['self', 'allies'],
  damage: ['self', ...DEBUFF_TO],
  slow: ['self', ...DEBUFF_TO],
  status: ['self', 'allies', ...DEBUFF_TO],
  mana: ['self'],
  vigor: ['self'],
  'extra-on-hit': ['self'],
  'damage-reduction': ['self'],
  execute: ['target', 'area', 'nearby'],
  'extra-action': ['self'],
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
      const appliesTo = oneOf(['self', 'target', 'area', 'nearby', 'allies'] as const, r.appliesTo, `${field}.appliesTo`);
      const allowed = APPLIES_TO_BY_KIND[rule.kind];
      if (!allowed.includes(appliesTo)) throw new HttpError(400, `${field}.appliesTo «${appliesTo}» no vale para ${rule.kind}`);
      // «self» es lo de por defecto salvo en daño / ralentización / estado (en un estado, self = al portador).
      if (appliesTo !== 'self' || rule.kind === 'status') rule.appliesTo = appliesTo;
    }
    if (r.levelFrom !== undefined && r.levelFrom !== null && r.levelFrom !== '') rule.levelFrom = oneOf(['target'] as const, r.levelFrom, `${field}.levelFrom`);
    if (r.lifeSteal !== undefined && r.lifeSteal !== null) {
      if (typeof r.lifeSteal !== 'boolean') throw new HttpError(400, `${field}.lifeSteal tiene que ser sí/no`);
      if (r.lifeSteal) {
        if (rule.kind !== 'damage') throw new HttpError(400, `${field}.lifeSteal solo vale en reglas de daño`);
        rule.lifeSteal = true;
      }
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
    const targetHpBelowPct = optNumber(r.targetHpBelowPct, `${field}.targetHpBelowPct`, 0, 100);
    if (targetHpBelowPct !== undefined) rule.targetHpBelowPct = targetHpBelowPct;
    const healFromDealtPct = optNumber(r.healFromDealtPct, `${field}.healFromDealtPct`, 0, 1000);
    if (healFromDealtPct !== undefined) rule.healFromDealtPct = healFromDealtPct;
    const fromDamagePct = optNumber(r.fromDamagePct, `${field}.fromDamagePct`, 0, 1000);
    if (fromDamagePct !== undefined) rule.fromDamagePct = fromDamagePct;
    if (r.vs !== undefined && r.vs !== null && r.vs !== '') rule.vs = oneOf(['aa', 'all'] as const, r.vs, `${field}.vs`);
    const action = optText(r.action, `${field}.action`, 40);
    if (action) rule.action = action;
    const dice = optText(r.dice, `${field}.dice`, 40);
    if (dice) {
      if (!/^\d*d\d+(?:[+-]\d+(?:\.\d+)?)?$/i.test(dice.replace(/\s+/g, ''))) throw new HttpError(400, `${field}.dice no es una tirada válida (p. ej. 4d10+13)`);
      rule.dice = dice.replace(/\s+/g, '');
    }
    const everyN = optNumber(r.everyN, `${field}.everyN`, 2, 99);
    if (everyN !== undefined) {
      if (!Number.isInteger(everyN)) throw new HttpError(400, `${field}.everyN tiene que ser un entero`);
      rule.everyN = everyN;
    }
    if (r.perTargetCounter === true) rule.perTargetCounter = true;
    const missingHpScalePct = optNumber(r.missingHpScalePct, `${field}.missingHpScalePct`, 0, 1000);
    if (missingHpScalePct !== undefined) rule.missingHpScalePct = missingHpScalePct;
    if (r.triggerAtMax === true) rule.triggerAtMax = true;
    if (r.requiresMaxStacks === true) rule.requiresMaxStacks = true;
    const delayTurns = optTurns(r.delayTurns, `${field}.delayTurns`);
    if (delayTurns) rule.delayTurns = delayTurns;
    const halfAfterTurns = optTurns(r.halfAfterTurns, `${field}.halfAfterTurns`);
    if (halfAfterTurns) rule.halfAfterTurns = halfAfterTurns;
    const fromManaSpentPct = optNumber(r.fromManaSpentPct, `${field}.fromManaSpentPct`, 0, 1000);
    if (fromManaSpentPct !== undefined) rule.fromManaSpentPct = fromManaSpentPct;
    const critPotencyPct = optNumber(r.critPotencyPct, `${field}.critPotencyPct`, 0, 100);
    if (critPotencyPct !== undefined) rule.critPotencyPct = critPotencyPct;
    if (r.pulseEachTurn === true) rule.pulseEachTurn = true;
    if (r.spellShield === true) rule.spellShield = true;
    if (r.cooldownOnProc === true) rule.cooldownOnProc = true;
    const unseenTurns = optTurns(r.unseenTurns, `${field}.unseenTurns`);
    if (unseenTurns) rule.unseenTurns = unseenTurns;
    const armedTurnsAfterSeen = optTurns(r.armedTurnsAfterSeen, `${field}.armedTurnsAfterSeen`);
    if (armedTurnsAfterSeen) rule.armedTurnsAfterSeen = armedTurnsAfterSeen;
    const auraRange = optNumber(r.auraRange, `${field}.auraRange`, 1, 20);
    if (auraRange !== undefined) {
      if (!Number.isInteger(auraRange)) throw new HttpError(400, `${field}.auraRange tiene que ser un entero`);
      rule.auraRange = auraRange;
    }
    const damageAmpPct = optNumber(r.damageAmpPct, `${field}.damageAmpPct`, 0, 1000);
    if (damageAmpPct !== undefined) rule.damageAmpPct = damageAmpPct;
    const duration = optTurns(r.duration, `${field}.duration`);
    if (duration) rule.duration = duration;
    // Máx. stacks hasta 999 (cargas permanentes como Flujo de maná: 120).
    const maxStacks = optNumber(r.maxStacks, `${field}.maxStacks`, 1, 999);
    if (maxStacks !== undefined && !Number.isInteger(maxStacks)) throw new HttpError(400, `${field}.maxStacks tiene que ser un entero`);
    if (maxStacks) rule.maxStacks = maxStacks;
    if (r.permanent !== undefined && r.permanent !== null && r.permanent !== false) {
      if (r.permanent !== true) throw new HttpError(400, `${field}.permanent tiene que ser true o false`);
      if (!['stat', 'attack-speed', 'move-speed'].includes(rule.kind)) throw new HttpError(400, `${field}.permanent solo vale para bonus de stat / velocidad`);
      rule.permanent = true;
    }
    if (r.onlyIf !== undefined && r.onlyIf !== null && r.onlyIf !== '') {
      const onlyIf = oneOf(['always', 'melee', 'ranged'] as const, r.onlyIf, `${field}.onlyIf`);
      if (onlyIf !== 'always') rule.onlyIf = onlyIf;
    }
    const note = optText(r.note, `${field}.note`, 120);
    if (note) rule.note = note;
    return rule;
  });
  const config: EffectBonusConfig = { rules };
  const cooldown = optTurns(source.cooldown, 'bonus.cooldown');
  if (cooldown) config.cooldown = cooldown;
  if (source.cooldownByLevel !== undefined && source.cooldownByLevel !== null) {
    if (!Array.isArray(source.cooldownByLevel) || source.cooldownByLevel.length > 4) throw new HttpError(400, 'bonus.cooldownByLevel: hasta 4 valores (niveles 1–5 / 6–10 / 11–15 / 16–20)');
    const list = source.cooldownByLevel.map((n, i) => optTurns(n, `bonus.cooldownByLevel[${i}]`)).filter((n): n is number => !!n);
    if (list.length) config.cooldownByLevel = list;
  }
  const duration = optTurns(source.duration, 'bonus.duration');
  if (duration) config.duration = duration;
  if (source.cdStart !== undefined && source.cdStart !== null) config.cdStart = oneOf(['on-activate', 'on-end'] as const, source.cdStart, 'bonus.cdStart');
  if (source.abilityDischarge !== undefined && source.abilityDischarge !== null) {
    if (typeof source.abilityDischarge !== 'boolean') throw new HttpError(400, 'bonus.abilityDischarge tiene que ser true o false');
    if (source.abilityDischarge) config.abilityDischarge = true;
  }
  if (source.chainTargets !== undefined && source.chainTargets !== null) {
    const chain = optNumber(source.chainTargets, 'bonus.chainTargets', 1, 10);
    if (chain !== undefined && !Number.isInteger(chain)) throw new HttpError(400, 'bonus.chainTargets tiene que ser un entero');
    if (chain && chain > 1) config.chainTargets = chain;
  }
  if (source.maxTargets !== undefined && source.maxTargets !== null) {
    const max = optNumber(source.maxTargets, 'bonus.maxTargets', 1, 20);
    if (max !== undefined && !Number.isInteger(max)) throw new HttpError(400, 'bonus.maxTargets tiene que ser un entero');
    if (max) config.maxTargets = max;
  }
  if (source.perTargetCooldown !== undefined && source.perTargetCooldown !== null) {
    if (typeof source.perTargetCooldown !== 'boolean') throw new HttpError(400, 'bonus.perTargetCooldown tiene que ser true o false');
    if (source.perTargetCooldown) config.perTargetCooldown = true;
  }
  if (source.oncePerCombat !== undefined && source.oncePerCombat !== null) {
    if (typeof source.oncePerCombat !== 'boolean') throw new HttpError(400, 'bonus.oncePerCombat tiene que ser true o false');
    if (source.oncePerCombat) config.oncePerCombat = true;
  }
  if (source.charges !== undefined && source.charges !== null) {
    if (typeof source.charges !== 'object' || Array.isArray(source.charges)) throw new HttpError(400, 'bonus.charges tiene que ser un objeto');
    const c = source.charges as Record<string, unknown>;
    const max = optNumber(c.max, 'bonus.charges.max', 1, 99);
    const every = optNumber(c.every, 'bonus.charges.every', 1, 99);
    const start = optNumber(c.start, 'bonus.charges.start', 0, 99);
    if (!max || !every || ![max, every, start ?? 0].every(Number.isInteger)) throw new HttpError(400, 'bonus.charges: max y every enteros 1-99, start entero 0-max');
    config.charges = { start: Math.min(start ?? max, max), max, every };
    if (c.perTurn === true) config.charges.perTurn = true;
  }
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
  /** { id: patrón de área (tablero) } solo de los que lo tienen. */
  area: Record<string, AreaPattern>;
};

export async function listNamedEffectDescriptions(): Promise<NamedEffectDescriptions> {
  const docs = await (await descriptions()).find({}).toArray();
  const result: NamedEffectDescriptions = { descriptions: {}, onHit: {}, bonus: {}, area: {} };
  for (const doc of docs) {
    if (typeof doc.description === 'string' && doc.description) result.descriptions[doc._id] = doc.description;
    if (typeof doc.onHit === 'boolean') result.onHit[doc._id] = doc.onHit;
    if (doc.bonus && typeof doc.bonus === 'object') result.bonus[doc._id] = doc.bonus;
    if (doc.area && typeof doc.area === 'object') result.area[doc._id] = doc.area;
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
  /** undefined = no se toca; null = se quita. */
  area?: AreaPattern | null;
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
  if ('area' in source) patch.area = parseAreaPattern(source.area) ?? null;
  if (patch.description === undefined && patch.onHit === undefined && patch.bonus === undefined && patch.area === undefined) {
    throw new HttpError(400, 'Nada que guardar (description, onHit, bonus o area)');
  }
  return patch;
}

export async function setNamedEffectDescription(patch: NamedEffectDescriptionPatch): Promise<{ id: string; description: string; onHit: boolean | null; bonus: EffectBonusConfig | null; area: AreaPattern | null }> {
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
  if (patch.area !== undefined) {
    if (patch.area === null) unset.area = '';
    else set.area = patch.area;
  }
  await col.updateOne(
    { _id: patch.id },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { upsert: true },
  );
  // Se borra solo si ya no queda nada (ni descripción, ni onHit, ni bonus, ni área).
  await col.deleteOne({ _id: patch.id, description: { $exists: false }, onHit: { $exists: false }, bonus: { $exists: false }, area: { $exists: false } });
  const doc = await col.findOne({ _id: patch.id });
  return {
    id: patch.id,
    description: typeof doc?.description === 'string' ? doc.description : '',
    onHit: typeof doc?.onHit === 'boolean' ? doc.onHit : null,
    bonus: doc?.bonus ?? null,
    area: doc?.area ?? null,
  };
}
