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
const TRIGGERS = ['always', 'on-hit', 'on-attack', 'after-ability', 'after-use', 'on-ability-hit', 'on-ability-damage', 'on-ability-use', 'on-cc', 'on-cc-taken', 'on-champion-combat', 'on-deal-any', 'on-deal-or-cc', 'on-use', 'on-takedown', 'hp-below', 'on-damage-taken', 'on-attacked', 'each-turn', 'energized-max', 'on-ultimate-use', 'on-enemy-ultimate-use', 'combat-start', 'combat-entry', 'when-ready', 'on-survived-hit', 'on-death', 'on-ally-heal-shield', 'on-move'] as const;
const LEGACY_DEAL_TRIGGERS: Record<string, 'physical' | 'magic' | 'true' | undefined> = { 'on-deal-physical': 'physical', 'on-deal-magic': 'magic', 'on-deal-true': 'true' };
const KINDS = ['stat', 'damage', 'heal', 'shield', 'shield-magic', 'shield-physical', 'temp-hp', 'mana', 'slow', 'status', 'extra-on-hit', 'attack-speed', 'move-speed', 'vigor', 'damage-reduction', 'damage-amp', 'vulnerable', 'execute', 'extra-action', 'burn', 'poison', 'crit-strike', 'cost-amp', 'arm-aa', 'on-hit-buff', 'shield-cut', 'effect-counter', 'ability-points', 'defer-damage', 'clear-effect', 'link-ally', 'link-redirect', 'link-heal'] as const;
const SCALING = ['baseAd', 'ad', 'bonusAd', 'ap', 'hp', 'bonusHp', 'itemBonusHp', 'missingHp', 'mana', 'bonusMana', 'armor', 'bonusArmor', 'mr', 'bonusMr', 'critChance', 'manaRegen', 'level', 'spe', 'targetMaxHp', 'targetCurrentHp', 'targetMissingHp', 'targetArmor', 'targetMr', 'targetSpe', 'targetAtkSpePct', 'lethality', 'dealtDamage', 'enemiesHit', 'effectStacks', 'currentMana', 'bonusManaRegen100', 'bonusManaLol', 'moveSpeedLol', 'bonusAtkSpePct', 'atkSpePct', 'adLol', 'apLol', 'movedSpeedPct', 'dealtPreMitigation', 'effectCounter', 'healDone', 'shieldDone'] as const;
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
  /** Daño: cada objetivo puede ser crítico (como un AA). */
  critRoll?: boolean;
  /** Daño: los objetivos dañados reciben los efectos de impacto del portador. */
  applyOnHit?: boolean;
  /** Área / cercanos: máximo de cercanos. */
  nearbyMax?: number;
  markedEffect?: string;
  markedChampionsMonstersOnly?: boolean;
  confirmPrompt?: string;
  fromApplierOnly?: boolean;
  markAs?: string;
  clearEffect?: string;
  linkEffect?: string;
  stat?: string;
  flat?: number;
  ratios?: { stat: (typeof SCALING)[number]; pct: number }[];
  perLevel?: number[];
  damageType?: (typeof DAMAGE_TYPES)[number];
  slowPct?: number;
  statusName?: string;
  count?: number;
  hpBelowPct?: number;
  hpAbovePct?: number;
  takenDamageTypes?: ('physical' | 'magic' | 'true')[];
  dealtDamageTypes?: ('physical' | 'magic' | 'true')[];
  takenFromChampionsOnly?: boolean;
  targetHpBelowPct?: number;
  healFromDealtPct?: number;
  fromDamagePct?: number;
  vs?: 'aa' | 'all' | 'crit';
  action?: string;
  dice?: string;
  everyN?: number;
  counterTurns?: number;
  /** Desborde a acci\u00f3n: cada m\u00faltiplo del total del stat \u2192 +1 acci\u00f3n y resta N del bonus. */
  overflowAt?: number;
  overflowAction?: 'abilities' | 'attacks';
  perTargetCounter?: boolean;
  missingHpScalePct?: number;
  selfMissingHpScale?: boolean;
  triggerAtMax?: boolean;
  requiresMaxStacks?: boolean;
  /** Fijo / por nivel en n\u00fameros del LoL (en combate / 10). */
  lolScale?: boolean;
  /** AD / AP del LoL de la regla. En un bonus de stat AD/AP se guarda y se acepta aunque no convierta a dados. */
  lolDice?: number;
  delayTurns?: number;
  delayDeathArea?: boolean;
  /** Curaci\u00f3n repartida en N tramos (2-20). */
  healOverTurns?: number;
  halfAfterTurns?: number;
  fromManaSpentPct?: number;
  rangedPct?: number;
  critPotencyPct?: number;
  pulseEachTurn?: boolean;
  spellShield?: boolean;
  cooldownOnProc?: boolean;
  unseenTurns?: number;
  armedTurnsAfterSeen?: number;
  auraRange?: number;
  damageAmpPct?: number;
  /** Amplifica el daño: tipos de daño del portador a los que se aplica (ausente = todos). */
  damageTypes?: ('physical' | 'magic' | 'true')[];
  /** Amplifica el da\u00f1o: solo habilidades / solo AA. */
  ampSource?: 'ability' | 'attack';
  /** Amplifica el da\u00f1o: +1% cada X de vida adicional del objetivo. */
  ampPerTargetBonusHp?: number;
  /** Tope de ampPerTargetBonusHp (%). */
  ampMaxPct?: number;
  /** Solo si el portador lleva X turnos sin combatir con campeones enemigos. */
  outOfCombatTurns?: number;
  /** Solo sin recibir da\u00f1o de campeones en N turnos / de no campeones en M (vac\u00edo = N). */
  noDamageTurns?: number;
  noDamageTurnsNonChampion?: number;
  /** Solo si el escalado del portador es \u2265 value. */
  minScaling?: { stat: (typeof SCALING)[number]; value: number };
  /** Siguiente AA cr\u00edtico: % del da\u00f1o cr\u00edtico total. */
  critDamagePct?: number;
  critCharges?: number;
  critIfCritPct?: number;
  critIfCritTruePct?: number;
  /** Cura: lo que sobra \u2192 vida temporal N turnos. */
  overhealTempHpTurns?: number;
  alternate?: 'a' | 'b';
  alternateName?: string;
  duration?: number;
  maxStacks?: number;
  /** Bonus de stat permanente (sin turnos en combate). */
  permanent?: boolean;
  /** Cargas permanentes que guardan el valor calculado de cada activación (se suma). */
  stackValue?: boolean;
  /** Cargas permanentes solo contador (no suma stats). */
  counterOnly?: boolean;
  /** \u00abAl matar / asistir\u00bb solo con campeones. */
  championTakedownOnly?: boolean;
  cutActiveShields?: boolean;
  counterName?: string;
  counterScale?: boolean;
  consumeCounter?: boolean;
  eachDamagedTarget?: boolean;
  counterMaxPerLevel?: number[];
  excludeBearer?: boolean;
  chainWoundedAlly?: boolean;
  matchTriggerShield?: boolean;
  basicAttackOnly?: boolean;
  dealItemDamage?: boolean;
  /** Cura / escudo en \u00e1rea: se elige a qui\u00e9n al aplicar. */
  pickTargets?: boolean;
  /** on-cc: solo con controles que inmovilizan. */
  ccImmobilizeOnly?: boolean;
  /** on-cc + ccImmobilizeOnly: ralentizar cuenta si el portador es cuerpo a cuerpo. */
  ccSlowIfMelee?: boolean;
  /** Solo si el objetivo es un campe\u00f3n. */
  championTargetsOnly?: boolean;
  largeMonstersOnly?: boolean;
  epicMonstersOnly?: boolean;
  championOrEpicOnly?: boolean;
  /** +% si hay m\u00e1s de un campe\u00f3n enemigo vivo en combate. */
  multiEnemyChampionPct?: number;
  /** Estado / ralentizaci\u00f3n / Vulnerable: reaplicar suma la duraci\u00f3n (si no, la renueva). */
  extendDuration?: boolean;
  /** Da\u00f1o con cargas que rebotan (principal + hasta N-1 adicionales). */
  bounceStacks?: number;
  /** % extra al principal por carga sobrante (por defecto 20). */
  bounceLeftoverPct?: number;
  /** Da\u00f1o: fijo contra no campeones (sustituye al fijo). */
  nonChampionFlat?: number;
  minValue?: number;
  nonChampionMax?: number;
  /** Decae durante la duración (stat / velocidades con turnos; no con permanent). */
  decays?: boolean;
  /** Cargas permanentes por disparo (por defecto 1; no se guarda si es 1). */
  stacksPerTrigger?: number;
  /** Solo si el portador es cuerpo a cuerpo (rango total ≤ 1, el 0 cuenta) o a distancia (rango > 1); ausente = siempre. */
  onlyIf?: 'melee' | 'ranged';
  note?: string;
};

export type EffectBonusConfig = {
  cooldown?: number;
  /** CD por tramo de nivel del portador (1–5 / 6–10 / 11–15 / 16–20). */
  cooldownByLevel?: number[];
  duration?: number;
  cdStart?: 'on-activate' | 'on-end' | 'on-break';
  /** Vigor: las habilidades que golpean también descargan el Vigor al máximo (Espada ciclovoltaica). */
  abilityDischarge?: boolean;
  /** Vigor al máximo: encadena a N objetivos (1-10; ausente = 1). */
  chainTargets?: number;
  /** Vigor al m\u00e1ximo: objetivos por nivel (hasta 20 enteros 1-10). */
  chainTargetsByLevel?: number[];
  /** Vigor encadenado: los secundarios reciben los efectos de impacto. */
  chainOnHit?: boolean;
  /** Requiere N aplicaciones al mismo objetivo (2-10). */
  hitsRequired?: number;
  /** Ventana del contador en turnos (1-20). */
  hitsWindow?: number;
  /** Solo campeones. */
  hitsChampionsOnly?: boolean;
  /** Da\u00f1o acumulado \u2265 X% de la vida m\u00e1xima del objetivo (0-100] en N turnos (1-20). */
  dealtPctRequired?: number;
  dealtPctWindow?: number;
  /** Enfriamiento por objetivo: el CD va en cada objetivo (marca por portador), no en el portador (Firmamento desgarrado). */
  perTargetCooldown?: boolean;
  /** Cada AA del portador reduce el CD restante en estos turnos (0.1-99, decimales). */
  cooldownReducedOnAttack?: number;
  /** Si el AA es cr\u00edtico, reduce el CD estos turnos en lugar del normal (0.01-99). */
  cooldownReducedOnCrit?: number;
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
  'shield-magic': ['self', 'allies'],
  'shield-physical': ['self', 'allies'],
  'temp-hp': ['self', 'allies'],
  damage: ['self', ...DEBUFF_TO],
  slow: ['self', ...DEBUFF_TO],
  status: ['self', 'allies', ...DEBUFF_TO],
  mana: ['self'],
  vigor: ['self'],
  'extra-on-hit': ['self'],
  'damage-reduction': ['self'],
  'damage-amp': ['self'],
  vulnerable: [...DEBUFF_TO],
  burn: [...DEBUFF_TO],
  poison: [...DEBUFF_TO],
  execute: ['target', 'area', 'nearby'],
  'extra-action': ['self'],
  'crit-strike': ['self'],
  'cost-amp': ['self'],
  'arm-aa': ['self'],
  'on-hit-buff': ['self', 'allies'],
  'shield-cut': [...DEBUFF_TO],
  'effect-counter': ['self'],
  'ability-points': ['self'],
  'defer-damage': ['self'],
  'clear-effect': ['self'],
  'link-ally': ['self'],
  'link-redirect': ['self'],
  'link-heal': ['self'],
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
    // Disparadores antiguos \u00abAl infligir da\u00f1o f\u00edsico / m\u00e1gico / verdadero\u00bb \u2192 \u00abAl infligir da\u00f1o\u00bb + ese tipo.
    const legacyDealt = typeof r.trigger === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_DEAL_TRIGGERS, r.trigger) ? LEGACY_DEAL_TRIGGERS[r.trigger] : undefined;
    const rule: EffectRule = { trigger: oneOf(TRIGGERS, legacyDealt ? 'on-deal-any' : r.trigger, `${field}.trigger`), kind: oneOf(KINDS, r.kind, `${field}.kind`) };
    if ((r.dealtDamageTypes !== undefined && r.dealtDamageTypes !== null) || legacyDealt) {
      if (r.dealtDamageTypes != null && !Array.isArray(r.dealtDamageTypes)) throw new HttpError(400, `${field}.dealtDamageTypes tiene que ser una lista`);
      if (rule.trigger !== 'on-deal-any' && rule.trigger !== 'on-deal-or-cc' && rule.trigger !== 'on-ability-damage') throw new HttpError(400, `${field}.dealtDamageTypes solo vale con \u00abAl infligir da\u00f1o\u00bb, \u00abAl infligir da\u00f1o o aplicar control\u00bb o \u00abAl infligir da\u00f1o con una habilidad\u00bb`);
      const list = [...new Set([...((r.dealtDamageTypes as unknown[] | null | undefined) ?? []).map((type, i) => oneOf(['physical', 'magic', 'true'] as const, type, `${field}.dealtDamageTypes[${i}]`)), ...(legacyDealt ? [legacyDealt] : [])])];
      if (list.length && list.length < 3) rule.dealtDamageTypes = list;
    }
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
    for (const key of ['critRoll', 'applyOnHit'] as const) {
      if (r[key] === undefined || r[key] === null) continue;
      if (typeof r[key] !== 'boolean') throw new HttpError(400, `${field}.${key} tiene que ser s\u00ed/no`);
      if (r[key]) {
        if (rule.kind !== 'damage') throw new HttpError(400, `${field}.${key} solo vale en reglas de da\u00f1o`);
        rule[key] = true;
      }
    }
    const nearbyMax = optNumber(r.nearbyMax, `${field}.nearbyMax`, 1, 20);
    if (nearbyMax !== undefined) {
      if (rule.appliesTo !== 'area' && rule.appliesTo !== 'nearby') throw new HttpError(400, `${field}.nearbyMax solo vale con \u00abObjetivo + cercanos\u00bb o \u00abSolo cercanos\u00bb`);
      rule.nearbyMax = Math.floor(nearbyMax);
    }
    if (r.stat !== undefined && r.stat !== null) rule.stat = oneOf([...SHEET_STAT_KEYS, 'adaptiveForce'] as const, r.stat, `${field}.stat`);
    if (rule.kind === 'stat' && !rule.stat) throw new HttpError(400, `${field}.stat es obligatoria en un bonus de stat`);
    const flat = optNumber(r.flat, `${field}.flat`, -9999, 9999);
    if (flat !== undefined) rule.flat = flat;
    if (r.ratios !== undefined && r.ratios !== null) {
      if (!Array.isArray(r.ratios) || r.ratios.length > 6) throw new HttpError(400, `${field}.ratios: lista de hasta 6`);
      rule.ratios = r.ratios.map((ratio, i) => {
        if (!ratio || typeof ratio !== 'object') throw new HttpError(400, `${field}.ratios[${i}] no es válido`);
        const x = ratio as Record<string, unknown>;
        return { stat: oneOf(SCALING, x.stat, `${field}.ratios[${i}].stat`), pct: optNumber(x.pct, `${field}.ratios[${i}].pct`, -100000, 100000) ?? 0 };
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
    if (r.counterMaxPerLevel !== undefined && r.counterMaxPerLevel !== null) {
      if (!Array.isArray(r.counterMaxPerLevel) || r.counterMaxPerLevel.length > 20) throw new HttpError(400, `${field}.counterMaxPerLevel: hasta 20 valores`);
      const list = r.counterMaxPerLevel.map((n, i) => {
        const value = optNumber(n, `${field}.counterMaxPerLevel[${i}]`, 1, 999);
        if (value === undefined || !Number.isInteger(value)) throw new HttpError(400, `${field}.counterMaxPerLevel[${i}] tiene que ser un entero`);
        return value;
      });
      if (list.length) rule.counterMaxPerLevel = list;
    }
    const counterName = optText(r.counterName, `${field}.counterName`, 40);
    if (counterName) rule.counterName = counterName;
    const markedEffect = optText(r.markedEffect, `${field}.markedEffect`, 60);
    if (markedEffect) {
      if (!/^[a-z0-9-]+$/.test(markedEffect)) throw new HttpError(400, `${field}.markedEffect tiene que ser el id base de un efecto (p. ej. baleful-blaze)`);
      rule.markedEffect = markedEffect;
    }
    const confirmPrompt = optText(r.confirmPrompt, `${field}.confirmPrompt`, 120);
    if (confirmPrompt) rule.confirmPrompt = confirmPrompt;
    const markAs = optText(r.markAs, `${field}.markAs`, 50);
    if (markAs) {
      if (!/^[a-z0-9-]+$/.test(markAs)) throw new HttpError(400, `${field}.markAs tiene que ser el id base de un efecto (p. ej. hypershot)`);
      rule.markAs = markAs;
    }
    const clearEffect = optText(r.clearEffect, `${field}.clearEffect`, 50);
    if (clearEffect) {
      if (!/^[a-z0-9-]+$/.test(clearEffect)) throw new HttpError(400, `${field}.clearEffect tiene que ser el id base de un efecto (p. ej. ignore-pain)`);
      rule.clearEffect = clearEffect;
    }
    const linkEffect = optText(r.linkEffect, `${field}.linkEffect`, 50);
    if (linkEffect) {
      if (!/^[a-z0-9-]+$/.test(linkEffect)) throw new HttpError(400, `${field}.linkEffect tiene que ser el id base de un efecto (p. ej. pledge)`);
      rule.linkEffect = linkEffect;
    }
    const count = optTurns(r.count, `${field}.count`);
    if (count) rule.count = count;
    const hpBelowPct = optNumber(r.hpBelowPct, `${field}.hpBelowPct`, 0, 100);
    if (hpBelowPct !== undefined) rule.hpBelowPct = hpBelowPct;
    const hpAbovePct = optNumber(r.hpAbovePct, `${field}.hpAbovePct`, 0, 100);
    if (hpAbovePct !== undefined) rule.hpAbovePct = hpAbovePct;
    if (r.takenDamageTypes !== undefined && r.takenDamageTypes !== null) {
      if (!Array.isArray(r.takenDamageTypes)) throw new HttpError(400, `${field}.takenDamageTypes tiene que ser una lista`);
      const taken = [...new Set(r.takenDamageTypes.map((type, i) => oneOf(['physical', 'magic', 'true'] as const, type, `${field}.takenDamageTypes[${i}]`)))];
      if (taken.length && taken.length < 3) rule.takenDamageTypes = taken;
    }
    if (r.takenFromChampionsOnly !== undefined && r.takenFromChampionsOnly !== null && r.takenFromChampionsOnly !== false) {
      if (r.takenFromChampionsOnly !== true) throw new HttpError(400, `${field}.takenFromChampionsOnly tiene que ser true o false`);
      rule.takenFromChampionsOnly = true;
    }
    const targetHpBelowPct = optNumber(r.targetHpBelowPct, `${field}.targetHpBelowPct`, 0, 100);
    if (targetHpBelowPct !== undefined) rule.targetHpBelowPct = targetHpBelowPct;
    const healFromDealtPct = optNumber(r.healFromDealtPct, `${field}.healFromDealtPct`, 0, 1000);
    if (healFromDealtPct !== undefined) rule.healFromDealtPct = healFromDealtPct;
    const fromDamagePct = optNumber(r.fromDamagePct, `${field}.fromDamagePct`, 0, 1000);
    if (fromDamagePct !== undefined) rule.fromDamagePct = fromDamagePct;
    if (r.vs !== undefined && r.vs !== null && r.vs !== '') rule.vs = oneOf(['aa', 'all', 'crit'] as const, r.vs, `${field}.vs`);
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
    const counterTurns = optNumber(r.counterTurns, `${field}.counterTurns`, 1, 99);
    if (counterTurns !== undefined) {
      if (!Number.isInteger(counterTurns)) throw new HttpError(400, `${field}.counterTurns tiene que ser un entero`);
      rule.counterTurns = counterTurns;
    }
    if (r.perTargetCounter === true) rule.perTargetCounter = true;
    const overflowAt = optNumber(r.overflowAt, `${field}.overflowAt`, 1, 999);
    if (overflowAt !== undefined) {
      if (!Number.isInteger(overflowAt)) throw new HttpError(400, `${field}.overflowAt tiene que ser un entero`);
      if (rule.kind !== 'stat') throw new HttpError(400, `${field}.overflowAt solo vale con Bonus de stat`);
      rule.overflowAt = overflowAt;
      if (r.overflowAction === 'attacks' || r.overflowAction === 'abilities') rule.overflowAction = r.overflowAction;
    }
    const missingHpScalePct = optNumber(r.missingHpScalePct, `${field}.missingHpScalePct`, 0, 1000);
    if (missingHpScalePct !== undefined) rule.missingHpScalePct = missingHpScalePct;
    if (r.selfMissingHpScale === true) rule.selfMissingHpScale = true;
    if (r.triggerAtMax === true) rule.triggerAtMax = true;
    if (r.requiresMaxStacks === true) rule.requiresMaxStacks = true;
    if (r.lolScale === true) rule.lolScale = true;
    const lolDice = optNumber(r.lolDice, `${field}.lolDice`, 0, 100000);
    if (lolDice !== undefined) rule.lolDice = lolDice;
    const delayTurns = optTurns(r.delayTurns, `${field}.delayTurns`);
    if (delayTurns) rule.delayTurns = delayTurns;
    if (r.delayDeathArea !== undefined && r.delayDeathArea !== null && r.delayDeathArea !== false) {
      if (r.delayDeathArea !== true) throw new HttpError(400, `${field}.delayDeathArea tiene que ser true o false`);
      if (delayTurns) rule.delayDeathArea = true;
    }
    const healOverTurns = optTurns(r.healOverTurns, `${field}.healOverTurns`);
    if (healOverTurns && healOverTurns >= 2) rule.healOverTurns = Math.min(20, healOverTurns);
    const halfAfterTurns = optTurns(r.halfAfterTurns, `${field}.halfAfterTurns`);
    if (halfAfterTurns) rule.halfAfterTurns = halfAfterTurns;
    const fromManaSpentPct = optNumber(r.fromManaSpentPct, `${field}.fromManaSpentPct`, 0, 1000);
    if (fromManaSpentPct !== undefined) rule.fromManaSpentPct = fromManaSpentPct;
    const rangedPct = optNumber(r.rangedPct, `${field}.rangedPct`, 0, 200);
    if (rangedPct !== undefined) rule.rangedPct = rangedPct;
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
    if (r.damageTypes !== undefined && r.damageTypes !== null) {
      if (!Array.isArray(r.damageTypes)) throw new HttpError(400, `${field}.damageTypes tiene que ser una lista`);
      const list = [...new Set(r.damageTypes.map((type, i) => oneOf(['physical', 'magic', 'true'] as const, type, `${field}.damageTypes[${i}]`)))];
      if (list.length && list.length < 3) rule.damageTypes = list;
    }
    if (r.ampSource !== undefined && r.ampSource !== null && r.ampSource !== '') {
      const ampSource = oneOf(['ability', 'attack'] as const, r.ampSource, `${field}.ampSource`);
      if (rule.kind !== 'damage-amp') throw new HttpError(400, `${field}.ampSource solo vale en \u00abAmplifica el da\u00f1o\u00bb`);
      rule.ampSource = ampSource;
    }
    const ampPerTargetBonusHp = optNumber(r.ampPerTargetBonusHp, `${field}.ampPerTargetBonusHp`, 0, 100000);
    if (ampPerTargetBonusHp) {
      if (rule.kind !== 'damage-amp') throw new HttpError(400, `${field}.ampPerTargetBonusHp solo vale en \u00abAmplifica el da\u00f1o\u00bb`);
      rule.ampPerTargetBonusHp = ampPerTargetBonusHp;
    }
    const ampMaxPct = optNumber(r.ampMaxPct, `${field}.ampMaxPct`, 0, 1000);
    if (ampMaxPct) {
      if (rule.kind !== 'damage-amp') throw new HttpError(400, `${field}.ampMaxPct solo vale en \u00abAmplifica el da\u00f1o\u00bb`);
      rule.ampMaxPct = ampMaxPct;
    }
    if (r.alternate !== undefined && r.alternate !== null && r.alternate !== '') {
      rule.alternate = oneOf(['a', 'b'] as const, r.alternate, `${field}.alternate`);
      const alternateName = optText(r.alternateName, `${field}.alternateName`, 20);
      if (alternateName) rule.alternateName = alternateName;
    }
    const outOfCombatTurns = optTurns(r.outOfCombatTurns, `${field}.outOfCombatTurns`);
    if (outOfCombatTurns) rule.outOfCombatTurns = outOfCombatTurns;
    const noDamageTurns = optTurns(r.noDamageTurns, `${field}.noDamageTurns`);
    const noDamageTurnsNonChampion = optTurns(r.noDamageTurnsNonChampion, `${field}.noDamageTurnsNonChampion`);
    if (noDamageTurnsNonChampion && !noDamageTurns) throw new HttpError(400, `${field}.noDamageTurnsNonChampion necesita noDamageTurns`);
    if (noDamageTurns) {
      rule.noDamageTurns = noDamageTurns;
      if (noDamageTurnsNonChampion) rule.noDamageTurnsNonChampion = noDamageTurnsNonChampion;
    }
    if (r.minScaling !== undefined && r.minScaling !== null) {
      if (typeof r.minScaling !== 'object' || Array.isArray(r.minScaling)) throw new HttpError(400, `${field}.minScaling no es v\u00e1lido`);
      const min = r.minScaling as Record<string, unknown>;
      const value = optNumber(min.value, `${field}.minScaling.value`, -100000, 100000);
      if (value === undefined) throw new HttpError(400, `${field}.minScaling.value es obligatorio`);
      rule.minScaling = { stat: oneOf(SCALING, min.stat, `${field}.minScaling.stat`), value };
    }
    const critDamagePct = optNumber(r.critDamagePct, `${field}.critDamagePct`, 1, 500);
    if (critDamagePct !== undefined) {
      if (rule.kind !== 'crit-strike') throw new HttpError(400, `${field}.critDamagePct solo vale en \u00abSiguiente AA cr\u00edtico\u00bb`);
      rule.critDamagePct = critDamagePct;
    }
    const critCharges = optNumber(r.critCharges, `${field}.critCharges`, 1, 20);
    if (critCharges !== undefined) {
      if (rule.kind !== 'crit-strike') throw new HttpError(400, `${field}.critCharges solo vale en \u00abSiguiente AA cr\u00edtico\u00bb`);
      rule.critCharges = Math.floor(critCharges);
    }
    const critIfCritPct = optNumber(r.critIfCritPct, `${field}.critIfCritPct`, 1, 500);
    if (critIfCritPct !== undefined) {
      if (rule.kind !== 'crit-strike') throw new HttpError(400, `${field}.critIfCritPct solo vale en \u00abSiguiente AA cr\u00edtico\u00bb`);
      rule.critIfCritPct = critIfCritPct;
    }
    const critIfCritTruePct = optNumber(r.critIfCritTruePct, `${field}.critIfCritTruePct`, 0, 1000);
    if (critIfCritTruePct !== undefined) {
      if (rule.kind !== 'crit-strike') throw new HttpError(400, `${field}.critIfCritTruePct solo vale en \u00abSiguiente AA cr\u00edtico\u00bb`);
      rule.critIfCritTruePct = critIfCritTruePct;
    }
    const overhealTempHpTurns = optTurns(r.overhealTempHpTurns, `${field}.overhealTempHpTurns`);
    if (overhealTempHpTurns) {
      if (rule.kind !== 'heal') throw new HttpError(400, `${field}.overhealTempHpTurns solo vale en curas`);
      rule.overhealTempHpTurns = overhealTempHpTurns;
    }
    // -1 = hasta el final del combate.
    const duration = r.duration === -1 ? -1 : optTurns(r.duration, `${field}.duration`);
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
    if (r.decays !== undefined && r.decays !== null && r.decays !== false) {
      if (r.decays !== true) throw new HttpError(400, `${field}.decays tiene que ser true o false`);
      if (!['stat', 'attack-speed', 'move-speed'].includes(rule.kind)) throw new HttpError(400, `${field}.decays solo vale para bonus de stat / velocidad`);
      if (!rule.permanent) rule.decays = true;
    }
    const bounceStacks = optNumber(r.bounceStacks, `${field}.bounceStacks`, 2, 20);
    if (bounceStacks !== undefined) {
      if (rule.kind !== 'damage') throw new HttpError(400, `${field}.bounceStacks solo vale en reglas de da\u00f1o`);
      rule.bounceStacks = Math.floor(bounceStacks);
    }
    const bounceLeftoverPct = optNumber(r.bounceLeftoverPct, `${field}.bounceLeftoverPct`, 0, 500);
    if (bounceLeftoverPct !== undefined) {
      if (!rule.bounceStacks) throw new HttpError(400, `${field}.bounceLeftoverPct necesita bounceStacks`);
      rule.bounceLeftoverPct = bounceLeftoverPct;
    }
    const nonChampionFlat = optNumber(r.nonChampionFlat, `${field}.nonChampionFlat`, -100000, 100000);
    if (nonChampionFlat !== undefined) {
      if (rule.kind !== 'damage') throw new HttpError(400, `${field}.nonChampionFlat solo vale en reglas de da\u00f1o`);
      rule.nonChampionFlat = nonChampionFlat;
    }
    for (const key of ['minValue', 'nonChampionMax'] as const) {
      const value = optNumber(r[key], `${field}.${key}`, 0, 100000);
      if (value === undefined) continue;
      if (rule.kind !== 'damage') throw new HttpError(400, `${field}.${key} solo vale en reglas de da\u00f1o`);
      rule[key] = value;
    }
    if (r.ccImmobilizeOnly !== undefined && r.ccImmobilizeOnly !== null && r.ccImmobilizeOnly !== false) {
      if (r.ccImmobilizeOnly !== true) throw new HttpError(400, `${field}.ccImmobilizeOnly tiene que ser true o false`);
      if (rule.trigger !== 'on-cc' && rule.trigger !== 'on-cc-taken') throw new HttpError(400, `${field}.ccImmobilizeOnly solo vale con \u00abAl aplicar control\u00bb o \u00abAl recibir control\u00bb`);
      rule.ccImmobilizeOnly = true;
    }
    if (r.ccSlowIfMelee !== undefined && r.ccSlowIfMelee !== null && r.ccSlowIfMelee !== false) {
      if (r.ccSlowIfMelee !== true) throw new HttpError(400, `${field}.ccSlowIfMelee tiene que ser true o false`);
      if (!rule.ccImmobilizeOnly) throw new HttpError(400, `${field}.ccSlowIfMelee solo vale con \u00abSolo inmovilizaciones\u00bb`);
      rule.ccSlowIfMelee = true;
    }
    if (r.championTargetsOnly !== undefined && r.championTargetsOnly !== null && r.championTargetsOnly !== false) {
      if (r.championTargetsOnly !== true) throw new HttpError(400, `${field}.championTargetsOnly tiene que ser true o false`);
      rule.championTargetsOnly = true;
    }
    if (r.largeMonstersOnly !== undefined && r.largeMonstersOnly !== null && r.largeMonstersOnly !== false) {
      if (r.largeMonstersOnly !== true) throw new HttpError(400, `${field}.largeMonstersOnly tiene que ser true o false`);
      rule.largeMonstersOnly = true;
    }
    if (r.epicMonstersOnly !== undefined && r.epicMonstersOnly !== null && r.epicMonstersOnly !== false) {
      if (r.epicMonstersOnly !== true) throw new HttpError(400, `${field}.epicMonstersOnly tiene que ser true o false`);
      rule.epicMonstersOnly = true;
    }
    if (r.championOrEpicOnly !== undefined && r.championOrEpicOnly !== null && r.championOrEpicOnly !== false) {
      if (r.championOrEpicOnly !== true) throw new HttpError(400, `${field}.championOrEpicOnly tiene que ser true o false`);
      rule.championOrEpicOnly = true;
    }
    for (const key of ['cutActiveShields', 'dealItemDamage', 'counterScale', 'consumeCounter', 'eachDamagedTarget', 'basicAttackOnly', 'excludeBearer', 'chainWoundedAlly', 'matchTriggerShield', 'markedChampionsMonstersOnly', 'fromApplierOnly'] as const) {
      const flag = r[key];
      if (flag === undefined || flag === null || flag === false) continue;
      if (flag !== true) throw new HttpError(400, `${field}.${key} tiene que ser true o false`);
      rule[key] = true;
    }
    const multiEnemyChampionPct = optNumber(r.multiEnemyChampionPct, `${field}.multiEnemyChampionPct`, 0, 1000);
    if (multiEnemyChampionPct) rule.multiEnemyChampionPct = multiEnemyChampionPct;
    if (r.extendDuration !== undefined && r.extendDuration !== null && r.extendDuration !== false) {
      if (r.extendDuration !== true) throw new HttpError(400, `${field}.extendDuration tiene que ser true o false`);
      if (!['status', 'slow', 'vulnerable'].includes(rule.kind)) throw new HttpError(400, `${field}.extendDuration solo vale para estado / ralentizaci\u00f3n / Vulnerable`);
      rule.extendDuration = true;
    }
    if (r.stackValue !== undefined && r.stackValue !== null && r.stackValue !== false) {
      if (r.stackValue !== true) throw new HttpError(400, `${field}.stackValue tiene que ser true o false`);
      if (!rule.permanent) throw new HttpError(400, `${field}.stackValue solo vale con cargas permanentes`);
      rule.stackValue = true;
    }
    if (r.counterOnly !== undefined && r.counterOnly !== null && r.counterOnly !== false) {
      if (r.counterOnly !== true) throw new HttpError(400, `${field}.counterOnly tiene que ser true o false`);
      if (!rule.permanent) throw new HttpError(400, `${field}.counterOnly solo vale con cargas permanentes`);
      rule.counterOnly = true;
    }
    if (r.championTakedownOnly !== undefined && r.championTakedownOnly !== null && r.championTakedownOnly !== false) {
      if (r.championTakedownOnly !== true) throw new HttpError(400, `${field}.championTakedownOnly tiene que ser true o false`);
      if (rule.trigger !== 'on-takedown') throw new HttpError(400, `${field}.championTakedownOnly solo vale con \u00abAl matar / asistir\u00bb`);
      rule.championTakedownOnly = true;
    }
    if (r.pickTargets !== undefined && r.pickTargets !== null && r.pickTargets !== false) {
      if (r.pickTargets !== true) throw new HttpError(400, `${field}.pickTargets tiene que ser true o false`);
      if (!(['heal', 'shield', 'shield-magic', 'shield-physical'] as string[]).includes(rule.kind)) throw new HttpError(400, `${field}.pickTargets solo vale con cura o escudo`);
      rule.pickTargets = true;
    }
    const stacksPerTrigger = optNumber(r.stacksPerTrigger, `${field}.stacksPerTrigger`, 1, 999);
    if (stacksPerTrigger !== undefined) {
      if (!Number.isInteger(stacksPerTrigger)) throw new HttpError(400, `${field}.stacksPerTrigger tiene que ser un entero`);
      if (!['stat', 'attack-speed', 'move-speed', 'damage-amp'].includes(rule.kind)) throw new HttpError(400, `${field}.stacksPerTrigger solo vale para bonus de stat / velocidad / amplificaci\u00f3n de da\u00f1o`);
      if (stacksPerTrigger >= 2) rule.stacksPerTrigger = stacksPerTrigger;
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
  const duration = source.duration === -1 ? -1 : optTurns(source.duration, 'bonus.duration');
  if (duration) config.duration = duration;
  if (source.cdStart !== undefined && source.cdStart !== null) config.cdStart = oneOf(['on-activate', 'on-end', 'on-break'] as const, source.cdStart, 'bonus.cdStart');
  if (source.abilityDischarge !== undefined && source.abilityDischarge !== null) {
    if (typeof source.abilityDischarge !== 'boolean') throw new HttpError(400, 'bonus.abilityDischarge tiene que ser true o false');
    if (source.abilityDischarge) config.abilityDischarge = true;
  }
  if (source.chainTargets !== undefined && source.chainTargets !== null) {
    const chain = optNumber(source.chainTargets, 'bonus.chainTargets', 1, 10);
    if (chain !== undefined && !Number.isInteger(chain)) throw new HttpError(400, 'bonus.chainTargets tiene que ser un entero');
    if (chain && chain > 1) config.chainTargets = chain;
  }
  if (source.chainTargetsByLevel !== undefined && source.chainTargetsByLevel !== null) {
    const list = source.chainTargetsByLevel;
    if (!Array.isArray(list) || list.length > 20 || !list.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10)) throw new HttpError(400, 'bonus.chainTargetsByLevel tiene que ser una lista de hasta 20 enteros entre 1 y 10');
    if (list.length) config.chainTargetsByLevel = list as number[];
  }
  if (source.chainOnHit !== undefined && source.chainOnHit !== null) {
    if (typeof source.chainOnHit !== 'boolean') throw new HttpError(400, 'bonus.chainOnHit tiene que ser true o false');
    if (source.chainOnHit) config.chainOnHit = true;
  }
  if (source.hitsRequired !== undefined && source.hitsRequired !== null) {
    const hits = optNumber(source.hitsRequired, 'bonus.hitsRequired', 2, 10);
    if (hits !== undefined && !Number.isInteger(hits)) throw new HttpError(400, 'bonus.hitsRequired tiene que ser un entero');
    if (hits) config.hitsRequired = hits;
  }
  if (source.hitsWindow !== undefined && source.hitsWindow !== null) {
    const win = optNumber(source.hitsWindow, 'bonus.hitsWindow', 1, 20);
    if (win !== undefined && !Number.isInteger(win)) throw new HttpError(400, 'bonus.hitsWindow tiene que ser un entero');
    if (win && config.hitsRequired) config.hitsWindow = win;
  }
  if (source.hitsChampionsOnly !== undefined && source.hitsChampionsOnly !== null) {
    if (typeof source.hitsChampionsOnly !== 'boolean') throw new HttpError(400, 'bonus.hitsChampionsOnly tiene que ser true o false');
    if (source.hitsChampionsOnly && config.hitsRequired) config.hitsChampionsOnly = true;
  }
  if (source.dealtPctRequired !== undefined && source.dealtPctRequired !== null) {
    const pct = optNumber(source.dealtPctRequired, 'bonus.dealtPctRequired', 0.01, 100);
    if (pct) config.dealtPctRequired = pct;
  }
  if (source.dealtPctWindow !== undefined && source.dealtPctWindow !== null) {
    const win = optNumber(source.dealtPctWindow, 'bonus.dealtPctWindow', 1, 20);
    if (win !== undefined && !Number.isInteger(win)) throw new HttpError(400, 'bonus.dealtPctWindow tiene que ser un entero');
    if (win && config.dealtPctRequired) config.dealtPctWindow = win;
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
  if (source.cooldownReducedOnAttack !== undefined && source.cooldownReducedOnAttack !== null) {
    const by = optNumber(source.cooldownReducedOnAttack, 'bonus.cooldownReducedOnAttack', 0.01, 99);
    if (by) config.cooldownReducedOnAttack = Math.round(by * 100) / 100;
  }
  if (source.cooldownReducedOnCrit !== undefined && source.cooldownReducedOnCrit !== null) {
    const byCrit = optNumber(source.cooldownReducedOnCrit, 'bonus.cooldownReducedOnCrit', 0.01, 99);
    if (byCrit) config.cooldownReducedOnCrit = Math.round(byCrit * 100) / 100;
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
