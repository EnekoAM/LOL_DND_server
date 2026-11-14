import { RANKED_SLOTS, maxRank, type RankedSlot } from './abilityRanks';
import { RESOURCE_IDS, isResourceId, type ResourceId } from './resources';
import { HttpError } from './errors';
import { parseAreaPattern, type AreaPattern } from './areaPattern';
// Ciclo validate ↔ namedEffectDescriptions: solo se usan dentro de funciones (no al cargar el módulo).
import { parseEffectBonusConfig, type EffectBonusConfig } from './namedEffectDescriptions';

const PARTY_FIELDS = ['gold', 'level', 'exp', 'expToNextLevel'] as const;
const ROLL_RARITIES = ['basico', 'epico', 'legendario'] as const;

export type RollRarity = (typeof ROLL_RARITIES)[number];

export type RollRecord = {
  tirada: RollRarity;
  rareza: RollRarity;
};

const HISTORY_KINDS = ['tirada', 'crafteo', 'compra', 'venta'] as const;

export type HistoryKind = (typeof HISTORY_KINDS)[number];

const EQUIPMENT_LIMIT = 7;
const ABILITY_SLOTS = ['P', 'H1', 'H2', 'H3', 'R'] as const;

const SPAWN_TOKEN_KINDS = ['basico', 'epico', 'legendario', 'rollBasico', 'rollEpico'] as const;

export type SpawnTokenKind = (typeof SPAWN_TOKEN_KINDS)[number];

export type PartyPatch = Partial<Record<(typeof PARTY_FIELDS)[number], number>> & {
  /** Suma o resta esta cantidad al oro del grupo, sin sustituir el saldo. */
  addGold?: number;
  /** Suma (o resta si es negativo) tokens de spawn por rareza. */
  addSpawnTokens?: Partial<Record<SpawnTokenKind, number>>;
  /** Gasta 1 token de esa rareza (falla si no queda ninguno). */
  spendSpawnToken?: SpawnTokenKind;
  /** Muestra la sección Aumentos a los players en la barra lateral. */
  aumentosForPlayers?: boolean;
  /** Ruleta de aumentos: probabilidad (%) de cada rareza y coste en oro por tirada. */
  aumentoRoll?: AumentoRollSettings;
};

/** Ruleta de aumentos: primero sale una rareza según estas probabilidades (suman 100) y luego 3 aumentos al azar de esa rareza. */
export type AumentoRollSettings = {
  probs: Record<AugmentRarity, number>;
  cost: number;
};

function parseAumentoRoll(value: unknown): AumentoRollSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'aumentoRoll tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const rawProbs = source.probs;
  if (!rawProbs || typeof rawProbs !== 'object' || Array.isArray(rawProbs)) {
    throw new HttpError(400, 'aumentoRoll.probs tiene que ser un objeto con plata, oro y prismatico');
  }
  const probs = {} as Record<AugmentRarity, number>;
  for (const rarity of AUGMENT_RARITIES) {
    const prob = (rawProbs as Record<string, unknown>)[rarity];
    if (typeof prob !== 'number' || !Number.isInteger(prob) || prob < 0 || prob > 100) {
      throw new HttpError(400, `La probabilidad de ${rarity} tiene que ser un entero de 0 a 100`);
    }
    probs[rarity] = prob;
  }
  const total = AUGMENT_RARITIES.reduce((sum, rarity) => sum + probs[rarity], 0);
  if (total !== 100) throw new HttpError(400, `Las probabilidades tienen que sumar 100 (ahora suman ${total})`);
  const cost = source.cost ?? 0;
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0) {
    throw new HttpError(400, 'El coste de la tirada tiene que ser un entero de 0 o más');
  }
  return { probs, cost };
}

export type BasicAttackEntry = { type: string; scaling: number[] };
/** Un tipo (formato antiguo) o varios (p. ej. AD + AP). */
export type BasicAttack = BasicAttackEntry | BasicAttackEntry[];

export type PlayerPatch = {
  basicAttack?: BasicAttack | null;
  abilities?: Partial<Record<(typeof ABILITY_SLOTS)[number], string | null>>;
  equipamiento?: string[];
  build?: string[];
  stats?: Record<string, number | string>;
  /** Máximo de PG de combate (editable en la ficha). */
  hp?: number;
  /** PG actuales. */
  actualHp?: number;
  /** Escudo (no se muestra en la vista compacta). */
  escudo?: number;
  /** Vida temporal (solo en el editor). */
  vidaTemporal?: number;
  /** Máximo de maná (editable en la ficha). */
  mana?: number;
  /** Maná actual. */
  actualMana?: number;
  /** Inspiración D&D (sí/no). */
  inspiration?: boolean;
  /** Color del icono de inspiración (#RRGGBB). null lo quita. */
  accentColor?: string | null;
  /** Descansos cortos usados desde el último largo (0–2). */
  shortRestsUsed?: number;
  /** Ficha D&D (rol, características y extra). null la borra. */
  sheet?: PlayerSheet | null;
  /** Rangos de Q/W/E/R. Solo se mandan los huecos que cambian; el servidor valida contra el nivel. */
  abilityRanks?: Partial<Record<RankedSlot, number>>;
  /** Desbloqueos (pestañas Quest/Aumentos y quest de top). Solo las claves que cambian. */
  unlocks?: Partial<Record<PlayerUnlockKey, boolean>>;
  /** Quests añadidas desde la ficha (lista completa). La quest de top va en unlocks.questTop. */
  quests?: PlayerQuest[];
  /** Aumentos añadidos desde la ficha (lista completa). */
  aumentos?: PlayerAumento[];
  /** URL de la imagen de fondo de la ficha de este player. null la quita. */
  background?: string | null;
  /** Mecánica de personaje (Ruina / Humanidad / Fama). null la quita. */
  mechanic?: PlayerMechanic | null;
  /** Contadores de stacks (item:<nombre> | ability:<nombre>). */
  stacks?: Record<string, number>;
  /** Cooldowns restantes (item:<nombre> | ability:<nombre>). */
  cooldowns?: Record<string, number>;
  /** Efectos de ítem activos restantes (item:<nombre>). */
  activeEffects?: Record<string, number>;
};

export type PlayerQuest = { id: string; name: string; description?: string; reward?: string; done: boolean; hidden?: boolean };
/**
 * Aumento en la ficha. levels: efectos de nivel 1, 2 y 3 del propio aumento (no del player).
 * level: nivel actual del aumento (1-3), solo si tiene levels. catalogId: aumento del catálogo del que salió (opcional).
 */
export type PlayerAumento = {
  id: string;
  name: string;
  description?: string;
  hidden?: boolean;
  catalogId?: string;
  levels?: string[];
  level?: number;
};

/** Los aumentos con niveles tienen hasta 3 (nivel del aumento, aparte del nivel del player). */
export const AUGMENT_LEVEL_COUNT = 3;
export const AUGMENT_LEVEL_EFFECT_MAX = 500;

/**
 * Efectos de nivel 1, 2 y 3 (hasta 3 textos; los vacíos valen). Se quitan los vacíos del final:
 * el nivel máximo del aumento es el último nivel con efecto. Sin ningún efecto (o null/false) = sin niveles.
 */
function parseAugmentLevels(value: unknown, label: string): string[] | null {
  if (value === null || value === false) return null;
  if (!Array.isArray(value) || value.length > AUGMENT_LEVEL_COUNT) {
    throw new HttpError(400, `${label} tiene que ser una lista con hasta 3 efectos (nivel 1, 2 y 3)`);
  }
  const levels = value.map((raw, index) => {
    if (raw === null || raw === undefined) return '';
    if (typeof raw !== 'string') throw new HttpError(400, `El efecto de nivel ${index + 1} tiene que ser texto`);
    const text = raw.trim();
    if (text.length > AUGMENT_LEVEL_EFFECT_MAX) {
      throw new HttpError(400, `El efecto de nivel ${index + 1} admite como máximo ${AUGMENT_LEVEL_EFFECT_MAX} caracteres`);
    }
    return text;
  });
  while (levels.length > 0 && !levels[levels.length - 1]) levels.pop();
  return levels.length > 0 ? levels : null;
}

const ENTRY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ENTRIES = 100;

function entryText(raw: unknown, label: string, max: number, required: boolean): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(400, `Falta ${label}`);
    return undefined;
  }
  if (typeof raw !== 'string') throw new HttpError(400, `${label} tiene que ser texto`);
  const text = raw.trim();
  if (!text) {
    if (required) throw new HttpError(400, `Falta ${label}`);
    return undefined;
  }
  if (text.length > max) throw new HttpError(400, `${label} admite como máximo ${max} caracteres`);
  return text;
}

function entryBase(raw: unknown, field: string, index: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, `${field}[${index}] tiene que ser un objeto`);
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string' || !ENTRY_ID.test(source.id)) {
    throw new HttpError(400, `${field}[${index}].id no es válido`);
  }
  const name = entryText(source.name, `${field}[${index}].name`, 80, true) as string;
  const description = entryText(source.description, `${field}[${index}].description`, 500, false);
  return { source, id: source.id, name, description };
}

function entryList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser una lista`);
  if (value.length > MAX_ENTRIES) throw new HttpError(400, `${field} admite como máximo ${MAX_ENTRIES}`);
  return value;
}

function assertUniqueIds(list: { id: string }[], field: string) {
  if (new Set(list.map(entry => entry.id)).size !== list.length) throw new HttpError(400, `${field} tiene ids repetidos`);
}

function playerQuests(value: unknown): PlayerQuest[] {
  const list = entryList(value, 'quests').map((raw, index) => {
    const { source, id, name, description } = entryBase(raw, 'quests', index);
    const reward = entryText(source.reward, `quests[${index}].reward`, 120, false);
    if (source.done !== undefined && typeof source.done !== 'boolean') {
      throw new HttpError(400, `quests[${index}].done tiene que ser true o false`);
    }
    if (source.hidden !== undefined && typeof source.hidden !== 'boolean') {
      throw new HttpError(400, `quests[${index}].hidden tiene que ser true o false`);
    }
    const quest: PlayerQuest = { id, name, done: source.done === true };
    if (description) quest.description = description;
    if (reward) quest.reward = reward;
    if (source.hidden === true) quest.hidden = true;
    return quest;
  });
  assertUniqueIds(list, 'quests');
  return list;
}

function playerAumentos(value: unknown): PlayerAumento[] {
  const list = entryList(value, 'aumentos').map((raw, index) => {
    const { source, id, name, description } = entryBase(raw, 'aumentos', index);
    const hidden = source.hidden;
    if (hidden !== undefined && typeof hidden !== 'boolean') {
      throw new HttpError(400, `aumentos[${index}].hidden tiene que ser true o false`);
    }
    const aumento: PlayerAumento = { id, name };
    if (description) aumento.description = description;
    if (hidden === true) aumento.hidden = true;
    if (source.catalogId !== undefined && source.catalogId !== null && source.catalogId !== '') {
      if (typeof source.catalogId !== 'string' || !ENTRY_ID.test(source.catalogId)) {
        throw new HttpError(400, `aumentos[${index}].catalogId no es válido`);
      }
      aumento.catalogId = source.catalogId;
    }
    const levels = source.levels === undefined ? null : parseAugmentLevels(source.levels, `aumentos[${index}].levels`);
    if (levels) {
      const level = source.level === undefined || source.level === null ? 1 : source.level;
      if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > AUGMENT_LEVEL_COUNT) {
        throw new HttpError(400, `aumentos[${index}].level tiene que ser 1, 2 o 3`);
      }
      aumento.levels = levels;
      // No pasa del último nivel con efecto.
      aumento.level = Math.min(level, levels.length);
    }
    return aumento;
  });
  assertUniqueIds(list, 'aumentos');
  return list;
}

const PLAYER_UNLOCK_KEYS = ['quest', 'aumentos', 'questTop', 'questTopAssigned', 'questVisible', 'aumentosVisible'] as const;
export type PlayerUnlockKey = (typeof PLAYER_UNLOCK_KEYS)[number];

function playerUnlocks(value: unknown): Partial<Record<PlayerUnlockKey, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'unlocks tiene que ser un objeto');
  }
  const parsed: Partial<Record<PlayerUnlockKey, boolean>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!PLAYER_UNLOCK_KEYS.includes(key as PlayerUnlockKey)) {
      throw new HttpError(400, `Desbloqueo desconocido: ${key} (quest, aumentos, questTop, questVisible o aumentosVisible)`);
    }
    if (typeof raw !== 'boolean') throw new HttpError(400, `unlocks.${key} tiene que ser true o false`);
    parsed[key as PlayerUnlockKey] = raw;
  }
  if (Object.keys(parsed).length === 0) throw new HttpError(400, 'unlocks está vacío');
  return parsed;
}

export type PlayerReplace = {
  basicAttack?: BasicAttack;
  abilities: Record<(typeof ABILITY_SLOTS)[number], string | null>;
  equipamiento: string[];
  build: string[];
};

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'El cuerpo tiene que ser un objeto JSON');
  }
  return body as Record<string, unknown>;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new HttpError(400, `${field} tiene que ser una lista de textos`);
  }
  return value.map(item => item.trim());
}

function equipmentList(value: unknown): string[] {
  const items = stringList(value, 'equipamiento');
  if (items.length > EQUIPMENT_LIMIT) {
    throw new HttpError(400, `El equipamiento admite como máximo ${EQUIPMENT_LIMIT} ítems`);
  }
  return items;
}

function basicAttackEntry(value: unknown, field: string): BasicAttackEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} tiene que ser un objeto`);
  }
  const attack = value as Record<string, unknown>;
  if (typeof attack.type !== 'string' || !attack.type.trim()) {
    throw new HttpError(400, `${field}.type tiene que ser un texto`);
  }
  if (!Array.isArray(attack.scaling) || attack.scaling.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new HttpError(400, `${field}.scaling tiene que ser una lista de números`);
  }
  return { type: attack.type.trim(), scaling: attack.scaling };
}

/** Acepta un objeto { type, scaling } o una lista de ellos (p. ej. AD + AP). */
function basicAttack(value: unknown): BasicAttack {
  if (Array.isArray(value)) {
    if (!value.length) throw new HttpError(400, 'basicAttack no puede ser una lista vacía');
    return value.map((entry, index) => basicAttackEntry(entry, `basicAttack[${index}]`));
  }
  return basicAttackEntry(value, 'basicAttack');
}

function abilities(
  value: unknown,
  requireAll: boolean,
): Partial<Record<(typeof ABILITY_SLOTS)[number], string | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'abilities tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const parsed: Partial<Record<(typeof ABILITY_SLOTS)[number], string | null>> = {};
  for (const key of Object.keys(source)) {
    if (!ABILITY_SLOTS.includes(key as (typeof ABILITY_SLOTS)[number])) {
      throw new HttpError(400, `Hueco de habilidad desconocido: ${key}`);
    }
  }
  for (const slot of ABILITY_SLOTS) {
    if (!(slot in source)) {
      if (requireAll) throw new HttpError(400, `Falta la habilidad ${slot}`);
      continue;
    }
    const slotValue = source[slot];
    if (slotValue === null) {
      parsed[slot] = null;
      continue;
    }
    if (typeof slotValue !== 'string' || !slotValue.trim()) {
      throw new HttpError(400, `La habilidad ${slot} tiene que ser texto o null`);
    }
    parsed[slot] = slotValue.trim();
  }
  return parsed;
}

function rollRarity(value: unknown, field: string): RollRarity {
  if (typeof value !== 'string' || !ROLL_RARITIES.includes(value as RollRarity)) {
    throw new HttpError(400, `${field} tiene que ser basico, epico o legendario`);
  }
  return value as RollRarity;
}

export function parseRollRecord(body: unknown): RollRecord {
  const source = asObject(body);
  return {
    tirada: rollRarity(source.tirada, 'tirada'),
    rareza: rollRarity(source.rareza, 'rareza'),
  };
}

export function parsePartyPatch(body: unknown): PartyPatch {
  const source = asObject(body);
  const patch: PartyPatch = {};
  for (const key of PARTY_FIELDS) {
    if (source[key] === undefined) continue;
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new HttpError(400, `${key} tiene que ser un número`);
    }
    if (key === 'level' && (!Number.isInteger(value) || value < 1)) {
      throw new HttpError(400, 'level tiene que ser un entero mayor que 0');
    }
    if (key === 'expToNextLevel' && value <= 0) {
      throw new HttpError(400, 'expToNextLevel tiene que ser mayor que 0');
    }
    patch[key] = value;
  }
  if (source.addGold !== undefined) {
    const addGold = source.addGold;
    if (typeof addGold !== 'number' || !Number.isInteger(addGold) || addGold === 0) {
      throw new HttpError(400, 'addGold tiene que ser un entero distinto de 0');
    }
    if (patch.gold !== undefined) {
      throw new HttpError(400, 'No se puede fijar el oro y sumarlo a la vez');
    }
    patch.addGold = addGold;
  }
  if (source.addSpawnTokens !== undefined) {
    if (!source.addSpawnTokens || typeof source.addSpawnTokens !== 'object' || Array.isArray(source.addSpawnTokens)) {
      throw new HttpError(400, 'addSpawnTokens tiene que ser un objeto');
    }
    const raw = source.addSpawnTokens as Record<string, unknown>;
    const addSpawnTokens: Partial<Record<SpawnTokenKind, number>> = {};
    for (const key of Object.keys(raw)) {
      if (!SPAWN_TOKEN_KINDS.includes(key as SpawnTokenKind)) {
        throw new HttpError(400, `Rareza de token desconocida: ${key}`);
      }
      const value = raw[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value === 0) {
        throw new HttpError(400, `addSpawnTokens.${key} tiene que ser un entero distinto de 0`);
      }
      addSpawnTokens[key as SpawnTokenKind] = value;
    }
    if (Object.keys(addSpawnTokens).length === 0) {
      throw new HttpError(400, 'addSpawnTokens no puede estar vacío');
    }
    patch.addSpawnTokens = addSpawnTokens;
  }
  if (source.spendSpawnToken !== undefined) {
    if (typeof source.spendSpawnToken !== 'string' || !SPAWN_TOKEN_KINDS.includes(source.spendSpawnToken as SpawnTokenKind)) {
      throw new HttpError(400, 'spendSpawnToken tiene que ser basico, epico, legendario, rollBasico o rollEpico');
    }
    patch.spendSpawnToken = source.spendSpawnToken as SpawnTokenKind;
  }
  if (source.aumentosForPlayers !== undefined) {
    if (typeof source.aumentosForPlayers !== 'boolean') {
      throw new HttpError(400, 'aumentosForPlayers tiene que ser true o false');
    }
    patch.aumentosForPlayers = source.aumentosForPlayers;
  }
  if (source.aumentoRoll !== undefined) patch.aumentoRoll = parseAumentoRoll(source.aumentoRoll);
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}


function playerStats(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'stats tiene que ser un objeto');
  }
  const stats: Record<string, number | string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) throw new HttpError(400, 'stats no admite claves vacías');
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      stats[key] = raw;
      continue;
    }
    if (typeof raw === 'string') {
      stats[key] = raw;
      continue;
    }
    throw new HttpError(400, `stats.${key} tiene que ser un número o un texto`);
  }
  return stats;
}

function nonNegInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} tiene que ser un entero ≥ 0`);
  }
  return value;
}

export const ABILITY_SCORE_KEYS = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type AbilityScoreKey = (typeof ABILITY_SCORE_KEYS)[number];

/** Claves de la fila Extra, iguales que las columnas de Cálculos (statLine.ts). */
export const SHEET_STAT_KEYS = [
  'hp',
  'ac',
  'mr',
  'mana',
  'ad',
  'ap',
  'critChance',
  'critDamage',
  'spe',
  'atkSpe',
  'atkSpePct',
  'abSpe',
  'abSpePct',
  'lethality',
  'magicPen',
  'armorPenPct',
  'magicPenPct',
  'healShieldPct',
  'tenacityPct',
  'slowResistPct',
  'lifeStealPct',
  'omnivampPct',
  'range',
  'healthRegen',
  'manaRegen',
] as const;

/** Stats añadidas después: las tablas de rol antiguas no las traen y valen 0. */
const OPTIONAL_ROLE_STAT_KEYS: readonly SheetStatKey[] = ['armorPenPct', 'magicPenPct', 'healShieldPct', 'tenacityPct', 'slowResistPct', 'lifeStealPct', 'omnivampPct', 'range', 'healthRegen', 'manaRegen'];

export type SheetStatKey = (typeof SHEET_STAT_KEYS)[number];

/** Habilidades D&D 5e con competencia (players.sheet.skills). */
export const DND_SKILL_KEYS = [
  'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history',
  'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception',
  'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival',
] as const;

export type DndSkillKey = (typeof DND_SKILL_KEYS)[number];

/** Ficha D&D guardada en players.sheet. El modificador se calcula: floor((puntuación - 10) / 2). */
export type PlayerSheet = {
  /** Id del rol (colección roles), p. ej. "asesino-ad". */
  roleId: string;
  scores?: Record<AbilityScoreKey, number>;
  /** Bonos fijos que se suman al total (solo las claves distintas de 0). */
  extra?: Partial<Record<SheetStatKey, number | string>>;
  /** Competencias marcadas (solo `true`); `{}` si ninguna. */
  skills?: Partial<Record<DndSkillKey, boolean>>;
};

const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SCORE_MIN = 1;
const SCORE_MAX = 30;
const SHEET_TEXT_LIMIT = 20;

function sheetScores(value: unknown): Record<AbilityScoreKey, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'sheet.scores tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!ABILITY_SCORE_KEYS.includes(key as AbilityScoreKey)) {
      throw new HttpError(400, `Característica desconocida: ${key}`);
    }
  }
  const scores = {} as Record<AbilityScoreKey, number>;
  for (const key of ABILITY_SCORE_KEYS) {
    const raw = source[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < SCORE_MIN || raw > SCORE_MAX) {
      throw new HttpError(400, `sheet.scores.${key} tiene que ser un entero entre ${SCORE_MIN} y ${SCORE_MAX}`);
    }
    scores[key] = raw;
  }
  return scores;
}

function sheetExtra(value: unknown): Partial<Record<SheetStatKey, number | string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'sheet.extra tiene que ser un objeto');
  }
  const extra: Partial<Record<SheetStatKey, number | string>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SHEET_STAT_KEYS.includes(key as SheetStatKey)) throw new HttpError(400, `Stat extra desconocida: ${key}`);
    const stat = key as SheetStatKey;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) throw new HttpError(400, `sheet.extra.${key} tiene que ser un número`);
      if (raw !== 0) extra[stat] = raw;
      continue;
    }
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (text.length > SHEET_TEXT_LIMIT) throw new HttpError(400, `sheet.extra.${key} es demasiado largo`);
      if (text && text !== '0' && text !== '-') extra[stat] = text;
      continue;
    }
    throw new HttpError(400, `sheet.extra.${key} tiene que ser un número o un dado (por ejemplo 1d4)`);
  }
  return extra;
}

function sheetSkills(value: unknown): Partial<Record<DndSkillKey, boolean>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'sheet.skills tiene que ser un objeto');
  }
  const skills: Partial<Record<DndSkillKey, boolean>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!DND_SKILL_KEYS.includes(key as DndSkillKey)) throw new HttpError(400, `Habilidad desconocida: ${key}`);
    if (typeof raw !== 'boolean') throw new HttpError(400, `sheet.skills.${key} tiene que ser true o false`);
    if (raw) skills[key as DndSkillKey] = true;
  }
  return skills;
}

export function parsePlayerSheet(value: unknown): PlayerSheet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'sheet tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key !== 'roleId' && key !== 'scores' && key !== 'extra' && key !== 'skills') {
      throw new HttpError(400, `Campo de ficha desconocido: ${key}`);
    }
  }
  const roleId = typeof source.roleId === 'string' ? source.roleId.trim() : '';
  if (!ROLE_ID.test(roleId)) throw new HttpError(400, 'sheet.roleId tiene que ser un id de rol (p. ej. asesino-ad)');

  const sheet: PlayerSheet = { roleId };
  if (source.scores !== undefined && source.scores !== null) sheet.scores = sheetScores(source.scores);
  if (source.extra !== undefined && source.extra !== null) {
    const extra = sheetExtra(source.extra);
    if (Object.keys(extra).length) sheet.extra = extra;
  }
  if (source.skills !== undefined && source.skills !== null) sheet.skills = sheetSkills(source.skills);
  return sheet;
}

function abilityRanks(value: unknown): Partial<Record<RankedSlot, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'abilityRanks tiene que ser un objeto');
  }
  const parsed: Partial<Record<RankedSlot, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!RANKED_SLOTS.includes(key as RankedSlot)) {
      throw new HttpError(400, `Hueco con rango desconocido: ${key} (solo H1, H2, H3 y R)`);
    }
    const slot = key as RankedSlot;
    const rank = nonNegInt(raw, `abilityRanks.${key}`);
    if (rank > maxRank(slot)) throw new HttpError(400, `abilityRanks.${key} admite como máximo ${maxRank(slot)}`);
    parsed[slot] = rank;
  }
  return parsed;
}

const PLAYER_BACKGROUND_LIMIT = 2000;

/** Fondo propio de la ficha: URL (o ruta) de imagen; vacío o null lo quita. */
function playerBackground(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'background tiene que ser una URL o vacío');
  const url = value.trim();
  if (url.length > PLAYER_BACKGROUND_LIMIT) {
    throw new HttpError(400, `background puede tener como máximo ${PLAYER_BACKGROUND_LIMIT} caracteres`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(url)) throw new HttpError(400, 'background no puede tener saltos de línea');
  return url || null;
}


const FAMA_REGIONS = [
  'Demacia', 'Noxus', 'Freljord', 'Jonia', 'Piltover', 'Zaun',
  'Shurima', 'Targon', 'Bilgewater', 'Islas de la Sombra', 'Ixtal', 'Bandle',
] as const;

const RUINA_MIN = 1;
const RUINA_MAX = 20;
const HUMANIDAD_MIN = -10;
const HUMANIDAD_MAX = 10;

export type PlayerMechanic =
  | { type: 'ruina'; value: number }
  | { type: 'humanidad'; value: number }
  | { type: 'fama'; regions: Record<string, number> };

function playerMechanic(value: unknown): PlayerMechanic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'mechanic tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const type = source.type;
  if (type === 'ruina' || type === 'humanidad') {
    const raw = source.value;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      throw new HttpError(400, 'mechanic.value tiene que ser un entero');
    }
    if (type === 'ruina') {
      if (raw < RUINA_MIN || raw > RUINA_MAX) {
        throw new HttpError(400, `mechanic.value (ruina) tiene que estar entre ${RUINA_MIN} y ${RUINA_MAX}`);
      }
      return { type: 'ruina', value: raw };
    }
    if (raw < HUMANIDAD_MIN || raw > HUMANIDAD_MAX) {
      throw new HttpError(400, `mechanic.value (humanidad) tiene que estar entre ${HUMANIDAD_MIN} y ${HUMANIDAD_MAX}`);
    }
    return { type: 'humanidad', value: raw };
  }
  if (type === 'fama') {
    if (!source.regions || typeof source.regions !== 'object' || Array.isArray(source.regions)) {
      throw new HttpError(400, 'mechanic.regions tiene que ser un objeto');
    }
    const rawRegions = source.regions as Record<string, unknown>;
    for (const key of Object.keys(rawRegions)) {
      if (!(FAMA_REGIONS as readonly string[]).includes(key)) {
        throw new HttpError(400, `Región de fama desconocida: ${key}`);
      }
    }
    const regions: Record<string, number> = {};
    for (const region of FAMA_REGIONS) {
      const raw = rawRegions[region];
      if (raw === undefined) {
        regions[region] = 0;
        continue;
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        throw new HttpError(400, `mechanic.regions.${region} tiene que ser un entero`);
      }
      regions[region] = raw;
    }
    return { type: 'fama', regions };
  }
  throw new HttpError(400, 'mechanic.type tiene que ser ruina, humanidad o fama');
}

export function parsePlayerPatch(body: unknown): PlayerPatch {
  const source = asObject(body);
  const patch: PlayerPatch = {};
  if ('basicAttack' in source) {
    patch.basicAttack = source.basicAttack === null ? null : basicAttack(source.basicAttack);
  }
  if ('abilities' in source) patch.abilities = abilities(source.abilities, false);
  if ('equipamiento' in source) patch.equipamiento = equipmentList(source.equipamiento);
  if ('build' in source) patch.build = stringList(source.build, 'build');
  if ('stats' in source) patch.stats = playerStats(source.stats);
  if ('hp' in source) patch.hp = nonNegInt(source.hp, 'hp');
  if ('actualHp' in source) patch.actualHp = nonNegInt(source.actualHp, 'actualHp');
  if ('escudo' in source) patch.escudo = nonNegInt(source.escudo, 'escudo');
  if ('vidaTemporal' in source) patch.vidaTemporal = nonNegInt(source.vidaTemporal, 'vidaTemporal');
  if ('mana' in source) patch.mana = nonNegInt(source.mana, 'mana');
  if ('actualMana' in source) patch.actualMana = nonNegInt(source.actualMana, 'actualMana');
  if ('inspiration' in source) {
    if (typeof source.inspiration !== 'boolean') throw new HttpError(400, 'inspiration tiene que ser true o false');
    patch.inspiration = source.inspiration;
  }
  if ('accentColor' in source) {
    if (source.accentColor === null) patch.accentColor = null;
    else if (typeof source.accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(source.accentColor)) {
      throw new HttpError(400, 'accentColor tiene que ser un color hex #RRGGBB o null');
    } else patch.accentColor = source.accentColor.toLowerCase();
  }
  if ('shortRestsUsed' in source) {
    const value = source.shortRestsUsed;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2) {
      throw new HttpError(400, 'shortRestsUsed tiene que ser 0, 1 o 2');
    }
    patch.shortRestsUsed = value;
  }
  if ('sheet' in source) patch.sheet = source.sheet === null ? null : parsePlayerSheet(source.sheet);
  if ('abilityRanks' in source) patch.abilityRanks = abilityRanks(source.abilityRanks);
  if ('unlocks' in source) patch.unlocks = playerUnlocks(source.unlocks);
  if ('quests' in source) patch.quests = playerQuests(source.quests);
  if ('aumentos' in source) patch.aumentos = playerAumentos(source.aumentos);
  if ('background' in source) patch.background = playerBackground(source.background);
  if ('mechanic' in source) patch.mechanic = source.mechanic === null ? null : playerMechanic(source.mechanic);
  if ('stacks' in source) patch.stacks = parsePlayerStacks(source.stacks);
  if ('cooldowns' in source) patch.cooldowns = parsePlayerCooldowns(source.cooldowns);
  if ('activeEffects' in source) patch.activeEffects = parsePlayerActiveEffects(source.activeEffects);
  if ('unassignedPoints' in source) {
    throw new HttpError(400, 'unassignedPoints se calcula (nivel − puntos gastados); cambia abilityRanks');
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

const CHAMPION_SLOTS = ['P', 'Q', 'W', 'E', 'R'] as const;

export type ChampionSlot = (typeof CHAMPION_SLOTS)[number];

export type ChampionAbilityDamage = {
  type?: string;
  ap?: number[];
  ad?: number[];
  adSource?: 'total' | 'bonus';
  apSource?: 'total' | 'bonus';
  damageBonus?: number;
  hp?: number[];
  hpSource?: 'max' | 'current' | 'missing' | 'bonus';
  hpFrom?: 'target' | 'self';
  hpAdPer100?: number;
  hpAdPer?: number;
  hpAdSource?: 'total' | 'bonus' | 'itemDiceAvg';
};

export type ChampionAbilityEffect = {
  name: string;
  values?: number[];
  duration?: number[];
};

export type ChampionAbility = {
  name: string;
  description?: string;
  learned?: boolean;
  damage?: ChampionAbilityDamage;
  effect?: ChampionAbilityEffect[];
  cost?: string;
  hasStacks?: boolean;
  maxStacks?: number;
  /** Cooldown en turnos propios. */
  cooldown?: number;
  /** Duración del efecto en turnos. */
  effectDuration?: number;
  /** Destino del efecto al activar. Ausente = self. */
  effectTarget?: 'self' | 'enemy';
  /** Nombre del estado en combate si el objetivo es enemigo. */
  effectName?: string;
  /** Recurso que gasta. Ausente = el del campeón. */
  resource?: ResourceId;
  /** Fases 2, 3… (la base es la fase 1). Los campos ausentes heredan de la base. */
  variants?: ChampionAbilityVariant[];
  /** sequential (por defecto) = Usar avanza de fase; choose = se elige la fase al usar (combos de Hwei). */
  phaseMode?: 'sequential' | 'choose';
  /** Patrón de área (tablero): usuario, objetivo y casillas donde hace efecto. */
  area?: AreaPattern;
  /** La habilidad aplica efectos de impacto (dispara las reglas «Al aplicar efecto de impacto»). */
  appliesOnHit?: boolean;
  /** Mecánicas de combate: cargas, cargas por impacto, buff al activar, estado de la pasiva, daño por prob. de crítico. */
  mechanics?: ChampionAbilityMechanics;
};

export type ChampionAbilityMechanics = {
  /** reducePerChampionHit: cada campeón enemigo alcanzado (AA / habilidad) quita N turnos a la recarga. */
  charges?: { start: number; max: number; recharge: number[]; reducePerChampionHit?: number };
  stacks?: { turns: number; max: number; required?: number; onAa?: boolean; onAbilityHit?: boolean; onChampionTakedown?: boolean; onNonChampionKill?: boolean; stat?: string; perStack?: number[]; perTarget?: boolean; requiresDamage?: boolean; onChampionCc?: boolean; consumeAtMax?: boolean; countersPerTarget?: boolean; onMaxDamage?: boolean; onMaxSelfStats?: { stat: string; values: number[]; turns: number }[]; onMaxCooldown?: number; onMaxHeal?: { selfRatios?: { stat: CastPoolStat; values: number[] }[]; allyRatios?: { stat: CastPoolStat; values: number[] }[]; alliesToo?: boolean; flat?: number[]; flatByLevel?: boolean }; armArmedAaAtMax?: boolean; armArmedAaTurns?: number; onMaxStatus?: { name?: string; stat?: string; amount?: number; pct?: number } };
  requireStacks?: { from: string; count: number; consume?: boolean };
  permanentStacks?: { onAbilityChampionHit?: boolean; onTakedown?: boolean; takedownChampion?: number; takedownOther?: number; stat?: string; perStack?: number[]; byLevel?: boolean };
  grantPermanent?: { from: string; maxPerCast?: number; onKill?: boolean; perConsumedStack?: boolean };
  stackDamage?: { from: string; pct: number[]; type?: 'physical' | 'magic' | 'true'; byLevel?: boolean };
  sectorShots?: { count: number; cooldown: number[]; byLevel?: boolean; trigger?: 'aa' | 'cast' | 'both'; gap?: number[]; labels?: string[] };
  toggle?: { turns: number[]; fixedAttacks?: number };
  execute?: { hpPct: number; fear?: { name: string; turns: number; value?: number } };
  lifeSteal?: { efficacy: number };
  buff?: { turns: number; attackSpeed?: number[]; aaAd?: number[]; aaAppliesPassive?: boolean };
  appliesPassive?: boolean;
  aaCritBonus?: { pctPerFace: number };
  critNoDamage?: boolean;
  critDoublesPassive?: boolean;
  /** Reglas como las de los efectos con nombre de los ítems (mismo motor en combate). */
  effectRules?: EffectBonusConfig;
  /** Bonus de stat por tenerla aprendida, por rango. */
  learnedStats?: { stat: SheetStatKey; values: number[] }[];
  /** Escudo / curación al portador al usarla. */
  /** target ally = a los aliados elegidos; requiresHit = solo si alcanza a un enemigo; alliesToo = también a aliados que se elijan. */
  castPool?: { kind: 'shield' | 'heal'; ratios: { stat: CastPoolStat; values: number[] }[]; turns?: number; perChampionHit?: { stat: CastPoolStat; pct: number }; target?: 'self' | 'ally'; requiresHit?: boolean; requiresChampionHit?: boolean; alliesToo?: boolean; allAllies?: boolean; flat?: number[]; flatByLevel?: boolean; delayTurns?: number; lowHpBonus?: { belowHpPct: number; multiplier: number }; requiresSelfInArea?: boolean; requiresSelfStatus?: boolean };
  /** Escudo automático (inicio del combate; al romperse CD por rango con decimales; vuelve solo). */
  innateShield?: { flat?: number[]; ratios: { stat: CastPoolStat; values: number[] }[]; cooldown: number[]; reducePerHit?: number };
  /** Se puede volver a lanzar times veces gratis durante turns turnos tras usarla. */
  recast?: { times: number; turns: number };
  /** Al usarla, estado en sí mismo (bloquea la habilidad mientras dura). stat/amount/pct: bonus mientras dura. */
  selfStatus?: { name: string; turns: number; value?: number; stat?: SheetStatKey; amount?: number; pct?: number; pctValues?: number[]; amountValues?: number[]; fixedAttacks?: number; requiresChampionHit?: boolean; blocksRecast?: boolean; stats?: { stat: string; amount?: number; pct?: number; amountValues?: number[]; pctValues?: number[]; ratios?: { stat: CastPoolStat; values: number[] }[] }[]; damageReductionValues?: number[]; cancelable?: boolean; blocksAbility?: boolean; requiresSelfInArea?: boolean; durationByStacks?: { from: string; thresholds: { stacks: number; turns: number }[] } };
  selfStatuses?: ChampionAbilityMechanics['selfStatus'][];
  selfInArea?: boolean;
  selfInAreaLabel?: string;
  trailTurns?: number;
  centerEffect?: { name: string; duration: number; values?: number[] };
  empoweredAa?: { healHpPct?: number[]; hpSource?: 'max' | 'current' | 'missing' | 'bonus'; heal?: NonNullable<NonNullable<ChampionAbilityMechanics['stacks']>['onMaxHeal']>; healPerTarget?: boolean; applyAbilityDamage?: boolean; cooldown: number[]; byLevel?: boolean; reduceOnAbility?: number; reduceOnStruck?: number; reduceOnAuto?: number; skipAboveHpPct?: number };
  trap?: { turns: number; name?: string; applyOnPlace?: boolean; eruptEffect?: { name: string; values?: number[]; duration?: number[] }[]; eruptEffectName?: string; eruptEffectDuration?: number; damageOnDetonate?: boolean };
  reduceEmpoweredAaOnHit?: number;
  costHpMaxPct?: number;
  costHpMinCurrentPct?: number;
  /** No gasta la acción de habilidad del turno. */
  noAction?: boolean;
  /** Efecto enemigo a todos los enemigos del combate. */
  allEnemies?: boolean;
  /** Estado propio rompible (escudo de hechizos): al romperse, bonus por tenerla aprendida × learnedMultiplier durante breakTurns. */
  spellShield?: { status: string; turns: number; breakTurns: number; learnedMultiplier: number };
  isolated?: { multiplier?: number; slowPct?: number };
  evolutions?: { slots: number[] };
  evolve?: {
    name: string;
    description?: string;
    effect?: { name: string; values?: number[]; duration?: number[] }[];
    effectName?: string;
    effectDuration?: number;
    effectTarget?: 'self' | 'enemy';
    recast?: { times: number; turns: number };
    isolated?: { multiplier?: number; slowPct?: number };
    selfStatus?: ChampionAbilityMechanics['selfStatus'];
    recastOnTakedown?: { times: number; turns: number; max?: number; champion?: boolean };
    armArmedAa?: boolean;
  };
  recastOnTakedown?: { times: number; turns: number; max?: number; champion?: boolean };
  armedAa?: { type?: string; ad?: number[]; ap?: number[]; adSource?: 'total' | 'bonus'; apSource?: 'total' | 'bonus'; effectName?: string; effectDuration?: number; effect?: { name: string; values?: number[]; duration?: number[] }[]; endsSelfStatus?: boolean; turns?: number; hp?: number[]; hpSource?: 'max' | 'current' | 'missing' | 'bonus'; apPer100?: number; explodeFromLevel?: number; charges?: number; effectOnLastCharge?: boolean; applyDamageOnUse?: boolean };
  armArmedAa?: boolean;
  resistShred?: { pct: number[]; turns: number; armor?: boolean; mr?: boolean };
  aaOnHit?: { hp?: number[]; hpSource?: 'max' | 'current' | 'missing' | 'bonus'; apPer100?: number; type?: string; ad?: number[]; adSource?: 'total' | 'bonus'; ap?: number[]; apSource?: 'total' | 'bonus'; always?: boolean; perTargetStacks?: { turns: number; max?: number } };
  costStacks?: { amount: number; turns: number; max: number };
  deathBurst?: { turns: number; name?: string; stat?: string; pct?: number; amount?: number };
  damageLowHp?: { belowHpPct: number; multiplier: number; missingMaxBonusPct?: number };
  onAbilityUse?: { turns: number; attackSpeed?: number[] };
  resetSectorShots?: { from: string; count: number; requiresChampionHit?: boolean };
  strikes?: { count: number[]; perBonusAtkSpe?: number };
  mark?: { turns: number; detonateOn?: 'aa' | 'ability' | 'both'; damageOnDetonate?: boolean; refundMana?: { flat?: number[]; refundCost?: boolean }; applyOnAbilityHit?: boolean; name?: string };
  cleanse?: boolean;
  returnStrike?: { type: 'true' | 'magic' | 'physical' };
  takedownHeal?: { flat?: number[]; flatByLevel?: boolean; ratios?: { stat: CastPoolStat; values: number[] }[]; champion?: boolean };
  levelThresholds?: { level: number; name?: string; rangeBonus?: number; aaWave?: { type?: 'magic' | 'true' | 'physical'; ad?: number[]; adSource?: 'total' | 'bonus'; ap?: number[]; apSource?: 'total' | 'bonus'; requiresMaxStacks?: boolean }; permanentMaxStacks?: boolean }[];
  protect?: { name?: string; turns: number; damageReductionPct: number[]; target?: 'self' | 'ally' | 'allyOrSelf' };
  combatTraits?: ChampionCombatTraits;
};

export type ChampionCombatTraits = {
  capture?: { name?: string };
  combatStart?: { statusName: string; turns: number; pick?: 'enemy'; count?: number };
  combatEntry?: { statusName: string; turns?: number; appliesTo: 'allies' | 'self' | 'enemies' };
  tough?: { flat: number; name?: string; auraAllies?: boolean; onAllySurvive?: { atkSpe?: number; ac?: number; mr?: number } };
  aura?: { range: number; label?: string; abSpe?: number; minAbSpe?: number; manaCost?: number; manaCostPct?: number };
  mrScalesWithHp?: { max: number; min: number };
  formidable?: { hpPct: number };
  abilityDamageTaken?: { pct: number };
  absorbAllyMagic?: { chancePct?: number; name?: string };
  guardAlly?: { name?: string; turns: number };
  onAllyJoin?: { statusName?: string; turns?: number; pick?: 'enemy'; challenge?: boolean };
  packTactics?: { label?: string; hitBonus: number };
  unstoppableVsLowerHp?: { name?: string };
  trueSight?: { range: number; label?: string };
  deathNotice?: { text: string };
  challenge?: { statusName?: string; turns?: number };
  aaMark?: { name: string; max: number; consume?: boolean; damage?: number; damageType?: 'physical' | 'magic' | 'true'; status?: string; statusTurns?: number };
  onEnemyUltimate?: { oncePerCombat?: boolean; atkSpe?: number; ac?: number; mr?: number; taunt?: boolean; tauntName?: string; tauntTurns?: number; grantCharges?: number; grantChargeTo?: string };
};

const CAST_POOL_STATS = ['ad', 'bonusAd', 'baseAd', 'ap', 'hp', 'bonusHp', 'missingHp', 'armor', 'bonusArmor', 'mr', 'bonusMr', 'mana', 'bonusMana'] as const;
type CastPoolStat = (typeof CAST_POOL_STATS)[number];
const castPoolStat = (value: unknown, field: string): CastPoolStat => {
  if (typeof value !== 'string' || !(CAST_POOL_STATS as readonly string[]).includes(value)) throw new HttpError(400, `${field} tiene que ser ${CAST_POOL_STATS.join(', ')}`);
  return value as CastPoolStat;
};

function mechanicsInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} tiene que ser un entero entre ${min} y ${max}`);
  }
  return value;
}

function mechanicsList(value: unknown, field: string, min: number, max: number, integer: boolean): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 5 || value.some(item => typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max || (integer && !Number.isInteger(item)))) {
    throw new HttpError(400, `${field} tiene que ser una lista de hasta 5 números entre ${min} y ${max}`);
  }
  return value.length ? value : undefined;
}

const mechanicsObject = (value: unknown, field: string): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser un objeto`);
  return value as Record<string, unknown>;
};

/** Mecánicas de combate de una habilidad (undefined = ninguna). */
export function parseAbilityMechanics(value: unknown): ChampionAbilityMechanics | undefined {
  const source = mechanicsObject(value, 'mechanics');
  if (!source) return undefined;
  const out: ChampionAbilityMechanics = {};
  const charges = mechanicsObject(source.charges, 'mechanics.charges');
  if (charges) {
    const max = mechanicsInt(charges.max, 'mechanics.charges.max', 1, 99);
    const start = mechanicsInt(charges.start, 'mechanics.charges.start', 0, max);
    const recharge = mechanicsList(charges.recharge, 'mechanics.charges.recharge', 1, 99, true);
    if (!recharge) throw new HttpError(400, 'mechanics.charges.recharge: pon los turnos de recarga (por rango)');
    out.charges = { start, max, recharge };
    if (charges.reducePerChampionHit !== undefined && charges.reducePerChampionHit !== null) out.charges.reducePerChampionHit = mechanicsInt(charges.reducePerChampionHit, 'mechanics.charges.reducePerChampionHit', 1, 99);
  }
  const stacks = mechanicsObject(source.stacks, 'mechanics.stacks');
  if (stacks) {
    const max = mechanicsInt(stacks.max, 'mechanics.stacks.max', 1, 99);
    out.stacks = { turns: mechanicsInt(stacks.turns, 'mechanics.stacks.turns', 1, 99), max };
    if (stacks.required !== undefined && stacks.required !== null) out.stacks.required = mechanicsInt(stacks.required, 'mechanics.stacks.required', 1, max);
    if (stacks.onAa === false) out.stacks.onAa = false;
    if (stacks.onAbilityHit === true) out.stacks.onAbilityHit = true;
    if (stacks.onChampionTakedown === true) out.stacks.onChampionTakedown = true;
    if (stacks.onNonChampionKill === true) out.stacks.onNonChampionKill = true;
    if (typeof stacks.stat === 'string' && stacks.stat.trim()) out.stacks.stat = stacks.stat.trim().slice(0, 40);
    const perStack = mechanicsList(stacks.perStack, 'mechanics.stacks.perStack', 0, 100, false);
    if (perStack) out.stacks.perStack = perStack;
    if (stacks.perTarget === true) out.stacks.perTarget = true;
    if (stacks.requiresDamage === false) out.stacks.requiresDamage = false;
    if (stacks.onChampionCc === true) out.stacks.onChampionCc = true;
    if (stacks.consumeAtMax === true) out.stacks.consumeAtMax = true;
    if (stacks.countersPerTarget === true) out.stacks.countersPerTarget = true;
    if (stacks.onMaxDamage === true) out.stacks.onMaxDamage = true;
    if (stacks.onMaxDamage === false) out.stacks.onMaxDamage = false;
    if (Array.isArray(stacks.onMaxSelfStats) && stacks.onMaxSelfStats.length) {
      out.stacks.onMaxSelfStats = stacks.onMaxSelfStats.slice(0, 6).map((entry: unknown, index: number) => {
        const row = mechanicsObject(entry, `mechanics.stacks.onMaxSelfStats[${index}]`) ?? {};
        const stat = typeof row.stat === 'string' ? row.stat.trim().slice(0, 40) : '';
        if (!stat) throw new HttpError(400, `mechanics.stacks.onMaxSelfStats[${index}].stat es obligatorio`);
        const values = mechanicsList(row.values, `mechanics.stacks.onMaxSelfStats[${index}].values`, -999, 999, false);
        if (!values) throw new HttpError(400, `mechanics.stacks.onMaxSelfStats[${index}].values: pon los valores por rango`);
        return { stat, values, turns: mechanicsInt(row.turns, `mechanics.stacks.onMaxSelfStats[${index}].turns`, 1, 99) };
      });
    }
    if (stacks.onMaxCooldown !== undefined && stacks.onMaxCooldown !== null) out.stacks.onMaxCooldown = mechanicsInt(stacks.onMaxCooldown, 'mechanics.stacks.onMaxCooldown', 1, 99);
    if (stacks.armArmedAaAtMax === true) out.stacks.armArmedAaAtMax = true;
    if (stacks.armArmedAaTurns !== undefined && stacks.armArmedAaTurns !== null) out.stacks.armArmedAaTurns = mechanicsInt(stacks.armArmedAaTurns, 'mechanics.stacks.armArmedAaTurns', 1, 99);
    const onMaxStatus = mechanicsObject(stacks.onMaxStatus, 'mechanics.stacks.onMaxStatus');
    if (onMaxStatus) {
      const status: NonNullable<NonNullable<ChampionAbilityMechanics['stacks']>['onMaxStatus']> = {};
      if (typeof onMaxStatus.name === 'string' && onMaxStatus.name.trim()) status.name = onMaxStatus.name.trim().slice(0, 80);
      if (typeof onMaxStatus.stat === 'string' && onMaxStatus.stat.trim()) status.stat = onMaxStatus.stat.trim().slice(0, 40);
      if (typeof onMaxStatus.amount === 'number' && Number.isFinite(onMaxStatus.amount)) status.amount = onMaxStatus.amount;
      if (typeof onMaxStatus.pct === 'number' && Number.isFinite(onMaxStatus.pct)) status.pct = onMaxStatus.pct;
      if (status.stat || status.amount != null || status.pct != null) out.stacks.onMaxStatus = status;
    }
    const onMaxHeal = mechanicsObject(stacks.onMaxHeal, 'mechanics.stacks.onMaxHeal');
    if (onMaxHeal) {
      const parseHealRatios = (value: unknown, field: string): { stat: CastPoolStat; values: number[] }[] | undefined => {
        if (value === undefined || value === null) return undefined;
        if (!Array.isArray(value) || !value.length) return undefined;
        const list: { stat: CastPoolStat; values: number[] }[] = [];
        for (const [index, entry] of value.entries()) {
          const row = mechanicsObject(entry, `${field}[${index}]`);
          if (!row) continue;
          let stat = typeof row.stat === 'string' ? row.stat.trim() : '';
          if (stat === 'maxHp') stat = 'hp';
          if (stat !== 'hp' && stat !== 'ap' && stat !== 'ad' && stat !== 'bonusAd' && stat !== 'bonusAp') throw new HttpError(400, `${field}[${index}].stat no válido`);
          const values = mechanicsList(row.values, `${field}[${index}].values`, 0, 1000, false);
          if (!values) throw new HttpError(400, `${field}[${index}].values: pon los valores por rango`);
          list.push({ stat: stat as CastPoolStat, values });
        }
        return list.length ? list : undefined;
      };
      const heal: NonNullable<NonNullable<ChampionAbilityMechanics['stacks']>['onMaxHeal']> = {};
      const selfRatios = parseHealRatios(onMaxHeal.selfRatios, 'mechanics.stacks.onMaxHeal.selfRatios');
      const allyRatios = parseHealRatios(onMaxHeal.allyRatios, 'mechanics.stacks.onMaxHeal.allyRatios');
      if (selfRatios) heal.selfRatios = selfRatios;
      if (allyRatios) heal.allyRatios = allyRatios;
      if (onMaxHeal.alliesToo === true) heal.alliesToo = true;
      const healFlat = mechanicsList(onMaxHeal.flat, 'mechanics.stacks.onMaxHeal.flat', 0, 100000, false);
      if (healFlat) heal.flat = healFlat;
      if (onMaxHeal.flatByLevel === true) heal.flatByLevel = true;
      if (heal.selfRatios || heal.allyRatios || heal.flat) out.stacks.onMaxHeal = heal;
    }
  }
  const requireStacks = mechanicsObject(source.requireStacks, 'mechanics.requireStacks');
  if (requireStacks) {
    const from = typeof requireStacks.from === 'string' ? requireStacks.from.trim().slice(0, 80) : '';
    if (!from) throw new HttpError(400, 'mechanics.requireStacks.from: pon el nombre de la habilidad que tiene las cargas');
    out.requireStacks = { from, count: mechanicsInt(requireStacks.count, 'mechanics.requireStacks.count', 1, 999) };
    if (requireStacks.consume === false) out.requireStacks.consume = false;
  }
  const lifeSteal = mechanicsObject(source.lifeSteal, 'mechanics.lifeSteal');
  if (lifeSteal) {
    const efficacy = lifeSteal.efficacy ?? 100;
    if (typeof efficacy !== 'number' || !Number.isFinite(efficacy) || efficacy < 0 || efficacy > 200) throw new HttpError(400, 'mechanics.lifeSteal.efficacy tiene que ser un número entre 0 y 200');
    out.lifeSteal = { efficacy };
  }
  const permanentStacks = mechanicsObject(source.permanentStacks, 'mechanics.permanentStacks');
  if (permanentStacks) {
    out.permanentStacks = {};
    if (permanentStacks.onAbilityChampionHit === false) out.permanentStacks.onAbilityChampionHit = false;
    if (permanentStacks.onTakedown === true) out.permanentStacks.onTakedown = true;
    if (permanentStacks.takedownChampion !== undefined && permanentStacks.takedownChampion !== null) out.permanentStacks.takedownChampion = mechanicsInt(permanentStacks.takedownChampion, 'mechanics.permanentStacks.takedownChampion', 1, 9);
    if (permanentStacks.takedownOther !== undefined && permanentStacks.takedownOther !== null) out.permanentStacks.takedownOther = mechanicsInt(permanentStacks.takedownOther, 'mechanics.permanentStacks.takedownOther', 0, 9);
    if (typeof permanentStacks.stat === 'string' && permanentStacks.stat.trim()) out.permanentStacks.stat = permanentStacks.stat.trim().slice(0, 40);
    const perStack = mechanicsList(permanentStacks.perStack, 'mechanics.permanentStacks.perStack', 0, 100, false);
    if (perStack) out.permanentStacks.perStack = perStack;
    if (permanentStacks.byLevel === true) out.permanentStacks.byLevel = true;
  }
  const grantPermanent = mechanicsObject(source.grantPermanent, 'mechanics.grantPermanent');
  if (grantPermanent) {
    const from = typeof grantPermanent.from === 'string' ? grantPermanent.from.trim().slice(0, 80) : '';
    if (!from) throw new HttpError(400, 'mechanics.grantPermanent.from: pon el nombre de la habilidad que tiene las cargas');
    out.grantPermanent = { from };
    if (grantPermanent.maxPerCast !== undefined && grantPermanent.maxPerCast !== null) out.grantPermanent.maxPerCast = mechanicsInt(grantPermanent.maxPerCast, 'mechanics.grantPermanent.maxPerCast', 1, 99);
    if (grantPermanent.onKill === true) out.grantPermanent.onKill = true;
    if (grantPermanent.perConsumedStack === true) out.grantPermanent.perConsumedStack = true;
  }
  const stackDamage = mechanicsObject(source.stackDamage, 'mechanics.stackDamage');
  if (stackDamage) {
    const from = typeof stackDamage.from === 'string' ? stackDamage.from.trim().slice(0, 80) : '';
    if (!from) throw new HttpError(400, 'mechanics.stackDamage.from: pon el nombre de la habilidad que tiene las cargas');
    const pct = mechanicsList(stackDamage.pct, 'mechanics.stackDamage.pct', 0, 999, false);
    if (!pct) throw new HttpError(400, 'mechanics.stackDamage.pct: pon el % por rango');
    out.stackDamage = { from, pct };
    if (stackDamage.type !== undefined && stackDamage.type !== null && stackDamage.type !== 'magic') {
      if (stackDamage.type !== 'physical' && stackDamage.type !== 'true') throw new HttpError(400, 'mechanics.stackDamage.type tiene que ser physical, magic o true');
      out.stackDamage.type = stackDamage.type;
    }
    if (stackDamage.byLevel === true) out.stackDamage.byLevel = true;
  }
  const sectorShots = mechanicsObject(source.sectorShots, 'mechanics.sectorShots');
  if (sectorShots) {
    const cooldown = mechanicsList(sectorShots.cooldown, 'mechanics.sectorShots.cooldown', 1, 99, true);
    if (!cooldown) throw new HttpError(400, 'mechanics.sectorShots.cooldown: pon los turnos de CD');
    out.sectorShots = { count: mechanicsInt(sectorShots.count, 'mechanics.sectorShots.count', 2, 8), cooldown };
    if (sectorShots.byLevel === true) out.sectorShots.byLevel = true;
    if (sectorShots.trigger === 'cast' || sectorShots.trigger === 'both' || sectorShots.trigger === 'aa') out.sectorShots.trigger = sectorShots.trigger;
    const gap = mechanicsList(sectorShots.gap, 'mechanics.sectorShots.gap', 0, 99, true);
    if (gap) out.sectorShots.gap = gap;
    if (Array.isArray(sectorShots.labels)) {
      const labels = sectorShots.labels.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim().slice(0, 20)).slice(0, 8);
      if (labels.length) out.sectorShots.labels = labels;
    }
  }
  const toggle = mechanicsObject(source.toggle, 'mechanics.toggle');
  if (toggle) {
    const turns = mechanicsList(toggle.turns, 'mechanics.toggle.turns', 0, 99, true);
    if (!turns) throw new HttpError(400, 'mechanics.toggle.turns: pon la duración por rango (0 = hasta desactivar)');
    out.toggle = { turns };
    if (toggle.fixedAttacks !== undefined && toggle.fixedAttacks !== null) out.toggle.fixedAttacks = mechanicsInt(toggle.fixedAttacks, 'mechanics.toggle.fixedAttacks', 1, 99);
  }
  const execute = mechanicsObject(source.execute, 'mechanics.execute');
  if (execute) {
    out.execute = { hpPct: mechanicsInt(execute.hpPct, 'mechanics.execute.hpPct', 1, 99) };
    const fear = mechanicsObject(execute.fear, 'mechanics.execute.fear');
    if (fear) {
      const name = typeof fear.name === 'string' ? fear.name.trim().slice(0, 80) : '';
      if (!name) throw new HttpError(400, 'mechanics.execute.fear.name: pon el nombre del estado');
      out.execute.fear = { name, turns: mechanicsInt(fear.turns, 'mechanics.execute.fear.turns', 1, 99) };
      if (fear.value !== undefined && fear.value !== null) out.execute.fear.value = mechanicsInt(fear.value, 'mechanics.execute.fear.value', 1, 99);
    }
  }
  const buff = mechanicsObject(source.buff, 'mechanics.buff');
  if (buff) {
    out.buff = { turns: mechanicsInt(buff.turns, 'mechanics.buff.turns', 1, 99) };
    const attackSpeed = mechanicsList(buff.attackSpeed, 'mechanics.buff.attackSpeed', -999, 999, false);
    if (attackSpeed) out.buff.attackSpeed = attackSpeed;
    const aaAd = mechanicsList(buff.aaAd, 'mechanics.buff.aaAd', 0, 999, false);
    if (aaAd) out.buff.aaAd = aaAd;
    if (buff.aaAppliesPassive === true) out.buff.aaAppliesPassive = true;
  }
  if (source.appliesPassive === true) out.appliesPassive = true;
  const crit = mechanicsObject(source.aaCritBonus, 'mechanics.aaCritBonus');
  if (crit) {
    const pct = crit.pctPerFace ?? 0;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'mechanics.aaCritBonus.pctPerFace tiene que ser un número entre 0 y 100');
    out.aaCritBonus = { pctPerFace: pct };
  }
  if (source.critNoDamage === true) out.critNoDamage = true;
  if (source.critDoublesPassive === true) out.critDoublesPassive = true;
  if (source.effectRules !== undefined && source.effectRules !== null) {
    const config = parseEffectBonusConfig(source.effectRules);
    if (config.rules.length) out.effectRules = config;
  }
  if (source.learnedStats !== undefined && source.learnedStats !== null) {
    if (!Array.isArray(source.learnedStats) || source.learnedStats.length > 6) throw new HttpError(400, 'mechanics.learnedStats tiene que ser una lista de hasta 6');
    const list = source.learnedStats.map((entry, index) => {
      const item = mechanicsObject(entry, `mechanics.learnedStats[${index}]`) ?? {};
      if (typeof item.stat !== 'string' || !(SHEET_STAT_KEYS as readonly string[]).includes(item.stat)) throw new HttpError(400, `mechanics.learnedStats[${index}].stat no es una stat de la ficha`);
      const values = mechanicsList(item.values, `mechanics.learnedStats[${index}].values`, -999, 999, false);
      if (!values) throw new HttpError(400, `mechanics.learnedStats[${index}].values: pon el valor por rango`);
      return { stat: item.stat as SheetStatKey, values };
    });
    if (list.length) out.learnedStats = list;
  }
  const pool = mechanicsObject(source.castPool, 'mechanics.castPool');
  if (pool) {
    if (pool.kind !== 'shield' && pool.kind !== 'heal') throw new HttpError(400, 'mechanics.castPool.kind tiene que ser shield o heal');
    if (!Array.isArray(pool.ratios) || pool.ratios.length > 4) throw new HttpError(400, 'mechanics.castPool.ratios: lista de hasta 4');
    const ratios = pool.ratios.map((entry, index) => {
      const ratio = mechanicsObject(entry, `mechanics.castPool.ratios[${index}]`) ?? {};
      const values = mechanicsList(ratio.values, `mechanics.castPool.ratios[${index}].values`, 0, 1000, false);
      if (!values) throw new HttpError(400, `mechanics.castPool.ratios[${index}].values: pon el % por rango`);
      return { stat: castPoolStat(ratio.stat, `mechanics.castPool.ratios[${index}].stat`), values };
    });
    const castPool: NonNullable<ChampionAbilityMechanics['castPool']> = { kind: pool.kind, ratios };
    if (pool.turns !== undefined && pool.turns !== null) castPool.turns = mechanicsInt(pool.turns, 'mechanics.castPool.turns', 1, 99);
    const hit = mechanicsObject(pool.perChampionHit, 'mechanics.castPool.perChampionHit');
    if (hit) {
      const pct = hit.pct;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'mechanics.castPool.perChampionHit.pct tiene que ser un número entre 0 y 100');
      castPool.perChampionHit = { stat: castPoolStat(hit.stat, 'mechanics.castPool.perChampionHit.stat'), pct };
    }
    if (pool.target === 'ally') castPool.target = 'ally';
    else if (pool.target !== undefined && pool.target !== null && pool.target !== 'self') throw new HttpError(400, 'mechanics.castPool.target tiene que ser self o ally');
    if (pool.requiresHit === true) castPool.requiresHit = true;
    if (pool.requiresChampionHit === true) castPool.requiresChampionHit = true;
    if (pool.requiresSelfInArea === true) castPool.requiresSelfInArea = true;
    if (pool.requiresSelfStatus === true) castPool.requiresSelfStatus = true;
    if (pool.alliesToo === true) castPool.alliesToo = true;
    if (pool.allAllies === true) castPool.allAllies = true;
    const flat = mechanicsList(pool.flat, 'mechanics.castPool.flat', 0, 100000, false);
    if (flat) castPool.flat = flat;
    if (pool.flatByLevel === true) castPool.flatByLevel = true;
    if (pool.delayTurns !== undefined && pool.delayTurns !== null) castPool.delayTurns = mechanicsInt(pool.delayTurns, 'mechanics.castPool.delayTurns', 1, 99);
    const lowHp = mechanicsObject(pool.lowHpBonus, 'mechanics.castPool.lowHpBonus');
    if (lowHp) {
      const belowHpPct = mechanicsInt(lowHp.belowHpPct, 'mechanics.castPool.lowHpBonus.belowHpPct', 1, 100);
      const multiplier = typeof lowHp.multiplier === 'number' ? lowHp.multiplier : Number(lowHp.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) throw new HttpError(400, 'mechanics.castPool.lowHpBonus.multiplier tiene que ser un número entre 0 (no incluido) y 10');
      castPool.lowHpBonus = { belowHpPct, multiplier };
    }
    if (ratios.length || castPool.perChampionHit || castPool.flat) out.castPool = castPool;
  }
  const recast = mechanicsObject(source.recast, 'mechanics.recast');
  if (recast) out.recast = { times: mechanicsInt(recast.times, 'mechanics.recast.times', 1, 9), turns: mechanicsInt(recast.turns, 'mechanics.recast.turns', 0, 99) };
  const selfStatus = mechanicsObject(source.selfStatus, 'mechanics.selfStatus');
  if (selfStatus) {
    const name = typeof selfStatus.name === 'string' ? selfStatus.name.trim().slice(0, 60) : '';
    if (!name) throw new HttpError(400, 'mechanics.selfStatus.name: pon el nombre del estado');
    out.selfStatus = { name, turns: mechanicsInt(selfStatus.turns, 'mechanics.selfStatus.turns', 1, 99) };
    if (selfStatus.value !== undefined && selfStatus.value !== null) out.selfStatus.value = mechanicsInt(selfStatus.value, 'mechanics.selfStatus.value', 1, 999);
    if (selfStatus.stat !== undefined && selfStatus.stat !== null && selfStatus.stat !== '') {
      if (typeof selfStatus.stat !== 'string' || !(SHEET_STAT_KEYS as readonly string[]).includes(selfStatus.stat)) throw new HttpError(400, 'mechanics.selfStatus.stat no es una stat de la ficha');
      out.selfStatus.stat = selfStatus.stat as SheetStatKey;
      const amount = selfStatus.amount;
      const pct = selfStatus.pct;
      const okNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v !== 0 && Math.abs(v) <= 999;
      if (amount !== undefined && amount !== null) {
        if (!okNum(amount)) throw new HttpError(400, 'mechanics.selfStatus.amount tiene que ser un número distinto de 0 (máx. 999)');
        out.selfStatus.amount = amount as number;
      }
      if (pct !== undefined && pct !== null) {
        if (!okNum(pct)) throw new HttpError(400, 'mechanics.selfStatus.pct tiene que ser un número distinto de 0 (máx. 999)');
        out.selfStatus.pct = pct as number;
      }
      if (out.selfStatus.amount == null && out.selfStatus.pct == null && selfStatus.pctValues == null && selfStatus.amountValues == null) throw new HttpError(400, 'mechanics.selfStatus: pon amount, pct o valores por rango');
    }
    if (selfStatus.fixedAttacks !== undefined && selfStatus.fixedAttacks !== null) out.selfStatus.fixedAttacks = mechanicsInt(selfStatus.fixedAttacks, 'mechanics.selfStatus.fixedAttacks', 1, 99);
    const pctValues = mechanicsList(selfStatus.pctValues, 'mechanics.selfStatus.pctValues', -999, 999, false);
    if (pctValues) out.selfStatus.pctValues = pctValues;
    const amountValues = mechanicsList(selfStatus.amountValues, 'mechanics.selfStatus.amountValues', -999, 999, false);
    if (amountValues) out.selfStatus.amountValues = amountValues;
    if (selfStatus.requiresChampionHit === true) out.selfStatus.requiresChampionHit = true;
    if (selfStatus.blocksRecast === true) out.selfStatus.blocksRecast = true;
    if (selfStatus.cancelable === true) out.selfStatus.cancelable = true;
    if (selfStatus.blocksAbility === false) out.selfStatus.blocksAbility = false;
    if (selfStatus.requiresSelfInArea === true) out.selfStatus.requiresSelfInArea = true;
    const reduction = mechanicsList(selfStatus.damageReductionValues, 'mechanics.selfStatus.damageReductionValues', 0, 100, false);
    if (reduction) out.selfStatus.damageReductionValues = reduction;
    if (Array.isArray(selfStatus.stats)) {
      out.selfStatus.stats = selfStatus.stats.slice(0, 8).map((entry: unknown, index: number) => {
        const row = mechanicsObject(entry, `mechanics.selfStatus.stats[${index}]`) ?? {};
        const stat = typeof row.stat === 'string' ? row.stat.trim().slice(0, 40) : '';
        if (!stat) throw new HttpError(400, `mechanics.selfStatus.stats[${index}].stat es obligatorio`);
        const parsed: NonNullable<NonNullable<ChampionAbilityMechanics['selfStatus']>['stats']>[number] = { stat };
        if (row.amount !== undefined && row.amount !== null) {
          if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) throw new HttpError(400, `mechanics.selfStatus.stats[${index}].amount no es un número`);
          parsed.amount = row.amount;
        }
        if (row.pct !== undefined && row.pct !== null) {
          if (typeof row.pct !== 'number' || !Number.isFinite(row.pct)) throw new HttpError(400, `mechanics.selfStatus.stats[${index}].pct no es un número`);
          parsed.pct = row.pct;
        }
        const amountValues = mechanicsList(row.amountValues, `mechanics.selfStatus.stats[${index}].amountValues`, -99999, 99999, false);
        if (amountValues) parsed.amountValues = amountValues;
        const pctValues = mechanicsList(row.pctValues, `mechanics.selfStatus.stats[${index}].pctValues`, -999, 999, false);
        if (pctValues) parsed.pctValues = pctValues;
        if (Array.isArray(row.ratios)) {
          parsed.ratios = row.ratios.slice(0, 6).map((ratio: unknown, ratioIndex: number) => {
            const item = mechanicsObject(ratio, `mechanics.selfStatus.stats[${index}].ratios[${ratioIndex}]`) ?? {};
            const values = mechanicsList(item.values, `mechanics.selfStatus.stats[${index}].ratios[${ratioIndex}].values`, -999, 999, false);
            if (!values) throw new HttpError(400, `mechanics.selfStatus.stats[${index}].ratios[${ratioIndex}].values: pon los %`);
            return { stat: castPoolStat(item.stat, `mechanics.selfStatus.stats[${index}].ratios[${ratioIndex}].stat`), values };
          });
        }
        return parsed;
      });
    }
    const durationBy = mechanicsObject(selfStatus.durationByStacks, 'mechanics.selfStatus.durationByStacks');
    if (durationBy) {
      const from = typeof durationBy.from === 'string' ? durationBy.from.trim().slice(0, 80) : '';
      if (!from) throw new HttpError(400, 'mechanics.selfStatus.durationByStacks.from: pon el nombre de la habilidad');
      if (!Array.isArray(durationBy.thresholds) || !durationBy.thresholds.length) throw new HttpError(400, 'mechanics.selfStatus.durationByStacks.thresholds: pon los umbrales');
      const thresholds = durationBy.thresholds.slice(0, 8).map((entry: unknown, index: number) => {
        const row = mechanicsObject(entry, `mechanics.selfStatus.durationByStacks.thresholds[${index}]`) ?? {};
        return { stacks: mechanicsInt(row.stacks, `mechanics.selfStatus.durationByStacks.thresholds[${index}].stacks`, 0, 999), turns: mechanicsInt(row.turns, `mechanics.selfStatus.durationByStacks.thresholds[${index}].turns`, 0, 99) };
      });
      out.selfStatus.durationByStacks = { from, thresholds };
    }
    if (out.selfStatus.stat && out.selfStatus.amount == null && out.selfStatus.pct == null && !out.selfStatus.pctValues && !out.selfStatus.amountValues) {
      throw new HttpError(400, 'mechanics.selfStatus: pon amount, pct o valores por rango');
    }
  }
  if (Array.isArray(source.selfStatuses) && source.selfStatuses.length) {
    out.selfStatuses = source.selfStatuses.slice(0, 8).map((entry: unknown, index: number) => {
      const row = mechanicsObject(entry, `mechanics.selfStatuses[${index}]`) ?? {};
      const name = typeof row.name === 'string' ? row.name.trim().slice(0, 60) : '';
      if (!name) throw new HttpError(400, `mechanics.selfStatuses[${index}].name: pon el nombre del estado`);
      const parsed: NonNullable<ChampionAbilityMechanics['selfStatus']> = { name, turns: mechanicsInt(row.turns, `mechanics.selfStatuses[${index}].turns`, 1, 99) };
      if (row.stat !== undefined && row.stat !== null && row.stat !== '') {
        if (typeof row.stat !== 'string' || !(SHEET_STAT_KEYS as readonly string[]).includes(row.stat)) throw new HttpError(400, `mechanics.selfStatuses[${index}].stat no es una stat de la ficha`);
        parsed.stat = row.stat as SheetStatKey;
      }
      if (row.value !== undefined && row.value !== null) parsed.value = mechanicsInt(row.value, `mechanics.selfStatuses[${index}].value`, 1, 999);
      const pctValues = mechanicsList(row.pctValues, `mechanics.selfStatuses[${index}].pctValues`, -999, 999, false);
      if (pctValues) parsed.pctValues = pctValues;
      const amountValues = mechanicsList(row.amountValues, `mechanics.selfStatuses[${index}].amountValues`, -999, 999, false);
      if (amountValues) parsed.amountValues = amountValues;
      if (typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount !== 0) parsed.amount = row.amount;
      if (typeof row.pct === 'number' && Number.isFinite(row.pct) && row.pct !== 0) parsed.pct = row.pct;
      if (row.blocksAbility === false) parsed.blocksAbility = false;
      if (row.cancelable === true) parsed.cancelable = true;
      if (row.requiresSelfInArea === true) parsed.requiresSelfInArea = true;
      if (row.requiresChampionHit === true) parsed.requiresChampionHit = true;
      if (row.blocksRecast === true) parsed.blocksRecast = true;
      if (Array.isArray(row.stats)) {
        parsed.stats = row.stats.slice(0, 8).map((item: unknown, statIndex: number) => {
          const statRow = mechanicsObject(item, `mechanics.selfStatuses[${index}].stats[${statIndex}]`) ?? {};
          const stat = typeof statRow.stat === 'string' ? statRow.stat.trim() : '';
          if (!stat) throw new HttpError(400, `mechanics.selfStatuses[${index}].stats[${statIndex}].stat es obligatorio`);
          const one: NonNullable<NonNullable<ChampionAbilityMechanics['selfStatus']>['stats']>[number] = { stat };
          if (typeof statRow.amount === 'number' && Number.isFinite(statRow.amount)) one.amount = statRow.amount;
          if (typeof statRow.pct === 'number' && Number.isFinite(statRow.pct)) one.pct = statRow.pct;
          const av = mechanicsList(statRow.amountValues, `mechanics.selfStatuses[${index}].stats[${statIndex}].amountValues`, -99999, 99999, false);
          if (av) one.amountValues = av;
          const pv = mechanicsList(statRow.pctValues, `mechanics.selfStatuses[${index}].stats[${statIndex}].pctValues`, -999, 999, false);
          if (pv) one.pctValues = pv;
          return one;
        });
      }
      return parsed;
    });
  }
  if (source.selfInArea === true) out.selfInArea = true;
  if (typeof source.selfInAreaLabel === 'string' && source.selfInAreaLabel.trim()) out.selfInAreaLabel = source.selfInAreaLabel.trim().slice(0, 80);
  if (source.trailTurns !== undefined && source.trailTurns !== null) out.trailTurns = mechanicsInt(source.trailTurns, 'mechanics.trailTurns', 1, 99);
  const centerEffect = mechanicsObject(source.centerEffect, 'mechanics.centerEffect');
  if (centerEffect) {
    const name = typeof centerEffect.name === 'string' ? centerEffect.name.trim().slice(0, 80) : '';
    if (!name) throw new HttpError(400, 'mechanics.centerEffect.name: pon el nombre del estado');
    const parsed: NonNullable<ChampionAbilityMechanics['centerEffect']> = { name, duration: mechanicsInt(centerEffect.duration, 'mechanics.centerEffect.duration', 1, 99) };
    const values = mechanicsList(centerEffect.values, 'mechanics.centerEffect.values', -999, 999, false);
    if (values) parsed.values = values;
    out.centerEffect = parsed;
  }
  const empoweredAa = mechanicsObject(source.empoweredAa, 'mechanics.empoweredAa');
  if (empoweredAa) {
    const healHpPct = mechanicsList(empoweredAa.healHpPct, 'mechanics.empoweredAa.healHpPct', 0, 100, false);
    const cooldown = mechanicsList(empoweredAa.cooldown, 'mechanics.empoweredAa.cooldown', 1, 99, true);
    if (!cooldown) throw new HttpError(400, 'mechanics.empoweredAa.cooldown: pon el CD por tramo o rango');
    const parseEmpHeal = (value: unknown): NonNullable<NonNullable<ChampionAbilityMechanics['empoweredAa']>['heal']> | undefined => {
      const row = mechanicsObject(value, 'mechanics.empoweredAa.heal');
      if (!row) return undefined;
      const heal: NonNullable<NonNullable<ChampionAbilityMechanics['empoweredAa']>['heal']> = {};
      const parseRatios = (raw: unknown, field: string) => {
        if (!Array.isArray(raw) || !raw.length) return undefined;
        const list: { stat: CastPoolStat; values: number[] }[] = [];
        for (const [index, entry] of raw.entries()) {
          const item = mechanicsObject(entry, `${field}[${index}]`);
          if (!item) continue;
          let stat = typeof item.stat === 'string' ? item.stat.trim() : '';
          if (stat === 'maxHp') stat = 'hp';
          if (stat !== 'hp' && stat !== 'ap' && stat !== 'ad' && stat !== 'bonusAd' && stat !== 'bonusAp') throw new HttpError(400, `${field}[${index}].stat no válido`);
          const values = mechanicsList(item.values, `${field}[${index}].values`, 0, 1000, false);
          if (!values) throw new HttpError(400, `${field}[${index}].values: pon los valores por rango`);
          list.push({ stat: stat as CastPoolStat, values });
        }
        return list.length ? list : undefined;
      };
      const selfRatios = parseRatios(row.selfRatios, 'mechanics.empoweredAa.heal.selfRatios');
      if (selfRatios) heal.selfRatios = selfRatios;
      const healFlat = mechanicsList(row.flat, 'mechanics.empoweredAa.heal.flat', 0, 100000, false);
      if (healFlat) heal.flat = healFlat;
      if (row.flatByLevel === true) heal.flatByLevel = true;
      return (heal.selfRatios || heal.flat) ? heal : undefined;
    };
    const heal = parseEmpHeal(empoweredAa.heal);
    if (!healHpPct && !heal && empoweredAa.applyAbilityDamage !== true) {
      throw new HttpError(400, 'mechanics.empoweredAa: pon cura (heal / healHpPct) o applyAbilityDamage');
    }
    out.empoweredAa = { cooldown };
    if (healHpPct) out.empoweredAa.healHpPct = healHpPct;
    if (heal) out.empoweredAa.heal = heal;
    if (empoweredAa.healPerTarget === true) out.empoweredAa.healPerTarget = true;
    if (empoweredAa.applyAbilityDamage === true) out.empoweredAa.applyAbilityDamage = true;
    if (empoweredAa.hpSource !== undefined && empoweredAa.hpSource !== null && empoweredAa.hpSource !== '') {
      if (empoweredAa.hpSource !== 'max' && empoweredAa.hpSource !== 'current' && empoweredAa.hpSource !== 'missing' && empoweredAa.hpSource !== 'bonus') {
        throw new HttpError(400, 'mechanics.empoweredAa.hpSource tiene que ser max, current, missing o bonus');
      }
      out.empoweredAa.hpSource = empoweredAa.hpSource;
    }
    if (empoweredAa.byLevel === true) out.empoweredAa.byLevel = true;
    if (empoweredAa.reduceOnAbility !== undefined && empoweredAa.reduceOnAbility !== null) out.empoweredAa.reduceOnAbility = mechanicsInt(empoweredAa.reduceOnAbility, 'mechanics.empoweredAa.reduceOnAbility', 1, 99);
    if (empoweredAa.reduceOnStruck !== undefined && empoweredAa.reduceOnStruck !== null) out.empoweredAa.reduceOnStruck = mechanicsInt(empoweredAa.reduceOnStruck, 'mechanics.empoweredAa.reduceOnStruck', 1, 99);
    if (empoweredAa.reduceOnAuto !== undefined && empoweredAa.reduceOnAuto !== null) out.empoweredAa.reduceOnAuto = mechanicsInt(empoweredAa.reduceOnAuto, 'mechanics.empoweredAa.reduceOnAuto', 1, 99);
    if (empoweredAa.skipAboveHpPct !== undefined && empoweredAa.skipAboveHpPct !== null) out.empoweredAa.skipAboveHpPct = mechanicsInt(empoweredAa.skipAboveHpPct, 'mechanics.empoweredAa.skipAboveHpPct', 1, 100);
  }
  const trap = mechanicsObject(source.trap, 'mechanics.trap');
  if (trap) {
    out.trap = { turns: mechanicsInt(trap.turns, 'mechanics.trap.turns', 1, 99) };
    const trapName = typeof trap.name === 'string' ? trap.name.trim().slice(0, 60) : '';
    if (trapName) out.trap.name = trapName;
    if (trap.applyOnPlace === true) out.trap.applyOnPlace = true;
    if (trap.damageOnDetonate === false) out.trap.damageOnDetonate = false;
    const eruptName = typeof trap.eruptEffectName === 'string' ? trap.eruptEffectName.trim().slice(0, 80) : '';
    if (eruptName) out.trap.eruptEffectName = eruptName;
    if (trap.eruptEffectDuration !== undefined && trap.eruptEffectDuration !== null) {
      out.trap.eruptEffectDuration = mechanicsInt(trap.eruptEffectDuration, 'mechanics.trap.eruptEffectDuration', 1, 99);
    }
    if (Array.isArray(trap.eruptEffect) && trap.eruptEffect.length) {
      out.trap.eruptEffect = trap.eruptEffect.slice(0, 8).map((entry: unknown, index: number) => {
        const effect = mechanicsObject(entry, `mechanics.trap.eruptEffect[${index}]`) ?? {};
        const name = typeof effect.name === 'string' ? effect.name.trim().slice(0, 80) : '';
        if (!name) throw new HttpError(400, `mechanics.trap.eruptEffect[${index}].name es obligatorio`);
        const parsed: { name: string; values?: number[]; duration?: number[] } = { name };
        const values = mechanicsList(effect.values, `mechanics.trap.eruptEffect[${index}].values`, -999, 999, false);
        if (values) parsed.values = values;
        const duration = mechanicsList(effect.duration, `mechanics.trap.eruptEffect[${index}].duration`, 0, 99, true);
        if (duration) parsed.duration = duration;
        return parsed;
      });
      if (!out.trap.eruptEffectName) out.trap.eruptEffectName = out.trap.eruptEffect[0].name;
      if (out.trap.eruptEffectDuration == null) {
        const first = out.trap.eruptEffect[0].duration?.[0];
        if (typeof first === 'number') out.trap.eruptEffectDuration = first;
      }
    }
  }
  if (source.reduceEmpoweredAaOnHit !== undefined && source.reduceEmpoweredAaOnHit !== null) {
    out.reduceEmpoweredAaOnHit = mechanicsInt(source.reduceEmpoweredAaOnHit, 'mechanics.reduceEmpoweredAaOnHit', 1, 99);
  }
  if (source.costHpMaxPct !== undefined && source.costHpMaxPct !== null) {
    out.costHpMaxPct = mechanicsInt(source.costHpMaxPct, 'mechanics.costHpMaxPct', 1, 100);
  }
  if (source.costHpMinCurrentPct !== undefined && source.costHpMinCurrentPct !== null) {
    out.costHpMinCurrentPct = mechanicsInt(source.costHpMinCurrentPct, 'mechanics.costHpMinCurrentPct', 1, 100);
  }
  if (source.noAction === true) out.noAction = true;
  const innate = mechanicsObject(source.innateShield, 'mechanics.innateShield');
  if (innate) {
    if (!Array.isArray(innate.ratios) || innate.ratios.length > 4) throw new HttpError(400, 'mechanics.innateShield.ratios: lista de hasta 4');
    const ratios = innate.ratios.map((entry, index) => {
      const ratio = mechanicsObject(entry, `mechanics.innateShield.ratios[${index}]`) ?? {};
      const values = mechanicsList(ratio.values, `mechanics.innateShield.ratios[${index}].values`, 0, 1000, false);
      if (!values) throw new HttpError(400, `mechanics.innateShield.ratios[${index}].values: pon el % por rango`);
      return { stat: castPoolStat(ratio.stat, `mechanics.innateShield.ratios[${index}].stat`), values };
    });
    const cooldown = mechanicsList(innate.cooldown, 'mechanics.innateShield.cooldown', 1, 99, true);
    if (!cooldown) throw new HttpError(400, 'mechanics.innateShield.cooldown: pon los turnos de CD por rango');
    const shield: NonNullable<ChampionAbilityMechanics['innateShield']> = { ratios, cooldown };
    const flat = mechanicsList(innate.flat, 'mechanics.innateShield.flat', 0, 100000, false);
    if (flat) shield.flat = flat;
    if (innate.reducePerHit !== undefined && innate.reducePerHit !== null) {
      const per = innate.reducePerHit;
      if (typeof per !== 'number' || !Number.isFinite(per) || per <= 0 || per > 99) throw new HttpError(400, 'mechanics.innateShield.reducePerHit tiene que ser un número entre 0 y 99');
      shield.reducePerHit = per;
    }
    if (!ratios.length && !flat) throw new HttpError(400, 'mechanics.innateShield: pon base o %');
    out.innateShield = shield;
  }
  if (source.allEnemies === true) out.allEnemies = true;
  const shield = mechanicsObject(source.spellShield, 'mechanics.spellShield');
  if (shield) {
    const status = typeof shield.status === 'string' ? shield.status.trim().slice(0, 60) : '';
    if (!status) throw new HttpError(400, 'mechanics.spellShield.status: pon el nombre del estado');
    const multiplier = shield.learnedMultiplier;
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) throw new HttpError(400, 'mechanics.spellShield.learnedMultiplier tiene que ser un número entre 1 y 10');
    out.spellShield = { status, turns: mechanicsInt(shield.turns, 'mechanics.spellShield.turns', 1, 99), breakTurns: mechanicsInt(shield.breakTurns, 'mechanics.spellShield.breakTurns', 1, 99), learnedMultiplier: multiplier };
  }
  const isolated = mechanicsObject(source.isolated, 'mechanics.isolated');
  if (isolated) {
    const iso: NonNullable<ChampionAbilityMechanics['isolated']> = {};
    if (isolated.multiplier !== undefined && isolated.multiplier !== null) {
      const multiplier = typeof isolated.multiplier === 'number' ? isolated.multiplier : Number(isolated.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) throw new HttpError(400, 'mechanics.isolated.multiplier tiene que ser un número entre 0 (no incluido) y 10');
      iso.multiplier = multiplier;
    }
    if (isolated.slowPct !== undefined && isolated.slowPct !== null) iso.slowPct = mechanicsInt(isolated.slowPct, 'mechanics.isolated.slowPct', 1, 99);
    if (iso.multiplier != null || iso.slowPct != null) out.isolated = iso;
  }
  const evolutions = mechanicsObject(source.evolutions, 'mechanics.evolutions');
  if (evolutions) {
    const slots = mechanicsList(evolutions.slots, 'mechanics.evolutions.slots', 0, 9, true);
    if (!slots) throw new HttpError(400, 'mechanics.evolutions.slots: pon los huecos por rango');
    out.evolutions = { slots };
  }
  const parseRecast = (value: unknown, field: string): { times: number; turns: number; max?: number; champion?: boolean } => {
    const rec = mechanicsObject(value, field) ?? {};
    const parsed: { times: number; turns: number; max?: number; champion?: boolean } = { times: mechanicsInt(rec.times, `${field}.times`, 1, 9), turns: mechanicsInt(rec.turns, `${field}.turns`, 0, 99) };
    if (rec.max !== undefined && rec.max !== null) parsed.max = mechanicsInt(rec.max, `${field}.max`, 1, 99);
    if (rec.champion === true) parsed.champion = true;
    return parsed;
  };
  const parseIsolated = (value: unknown, field: string): { multiplier?: number; slowPct?: number } | undefined => {
    const src = mechanicsObject(value, field);
    if (!src) return undefined;
    const iso: { multiplier?: number; slowPct?: number } = {};
    if (src.multiplier !== undefined && src.multiplier !== null) {
      const multiplier = typeof src.multiplier === 'number' ? src.multiplier : Number(src.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) throw new HttpError(400, `${field}.multiplier tiene que ser un número entre 0 (no incluido) y 10`);
      iso.multiplier = multiplier;
    }
    if (src.slowPct !== undefined && src.slowPct !== null) iso.slowPct = mechanicsInt(src.slowPct, `${field}.slowPct`, 1, 99);
    return iso.multiplier != null || iso.slowPct != null ? iso : undefined;
  };
  const parseEvolveEffect = (value: unknown, field: string): { name: string; values?: number[]; duration?: number[] }[] | undefined => {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser una lista`);
    const effects: { name: string; values?: number[]; duration?: number[] }[] = [];
    for (const item of value) {
      const src = mechanicsObject(item, field) ?? {};
      const name = typeof src.name === 'string' ? src.name.trim().slice(0, 80) : '';
      if (!name) throw new HttpError(400, `${field}: cada efecto necesita un nombre`);
      const effect: { name: string; values?: number[]; duration?: number[] } = { name };
      const values = mechanicsList(src.values, `${field}.values`, -1000, 1000, false);
      const duration = mechanicsList(src.duration, `${field}.duration`, 0, 99, true);
      if (values) effect.values = values;
      if (duration) effect.duration = duration;
      effects.push(effect);
    }
    return effects.length ? effects : undefined;
  };
  const evolve = mechanicsObject(source.evolve, 'mechanics.evolve');
  if (evolve) {
    const name = typeof evolve.name === 'string' ? evolve.name.trim().slice(0, 80) : '';
    if (!name) throw new HttpError(400, 'mechanics.evolve.name: pon el nombre de la evolución');
    const ev: NonNullable<ChampionAbilityMechanics['evolve']> = { name };
    if (typeof evolve.description === 'string' && evolve.description.trim()) ev.description = evolve.description.trim();
    const evEffect = parseEvolveEffect(evolve.effect, 'mechanics.evolve.effect');
    if (evEffect) ev.effect = evEffect;
    if (typeof evolve.effectName === 'string' && evolve.effectName.trim()) ev.effectName = evolve.effectName.trim().slice(0, 80);
    if (evolve.effectDuration !== undefined && evolve.effectDuration !== null) ev.effectDuration = mechanicsInt(evolve.effectDuration, 'mechanics.evolve.effectDuration', 0, 99);
    if (evolve.effectTarget === 'enemy' || evolve.effectTarget === 'self') ev.effectTarget = evolve.effectTarget;
    else if (evolve.effectTarget !== undefined && evolve.effectTarget !== null) throw new HttpError(400, 'mechanics.evolve.effectTarget tiene que ser self o enemy');
    if (evolve.recast) ev.recast = parseRecast(evolve.recast, 'mechanics.evolve.recast');
    const evIso = parseIsolated(evolve.isolated, 'mechanics.evolve.isolated');
    if (evIso) ev.isolated = evIso;
    if (evolve.recastOnTakedown) ev.recastOnTakedown = parseRecast(evolve.recastOnTakedown, 'mechanics.evolve.recastOnTakedown');
    if (evolve.armArmedAa === true) ev.armArmedAa = true;
    out.evolve = ev;
  }
  if (source.recastOnTakedown) out.recastOnTakedown = parseRecast(source.recastOnTakedown, 'mechanics.recastOnTakedown');
  const armed = mechanicsObject(source.armedAa, 'mechanics.armedAa');
  if (armed) {
    const aa: NonNullable<ChampionAbilityMechanics['armedAa']> = {};
    if (typeof armed.type === 'string' && armed.type.trim()) aa.type = armed.type.trim().slice(0, 40);
    const ad = mechanicsList(armed.ad, 'mechanics.armedAa.ad', 0, 10, false);
    const ap = mechanicsList(armed.ap, 'mechanics.armedAa.ap', 0, 10, false);
    if (ad) aa.ad = ad;
    if (ap) aa.ap = ap;
    if (armed.adSource === 'bonus' || armed.adSource === 'total') aa.adSource = armed.adSource;
    if (armed.apSource === 'bonus' || armed.apSource === 'total') aa.apSource = armed.apSource;
    if (typeof armed.effectName === 'string' && armed.effectName.trim()) aa.effectName = armed.effectName.trim().slice(0, 80);
    if (armed.effectDuration !== undefined && armed.effectDuration !== null) aa.effectDuration = mechanicsInt(armed.effectDuration, 'mechanics.armedAa.effectDuration', 1, 99);
    const aaEffect = parseEvolveEffect(armed.effect, 'mechanics.armedAa.effect');
    if (aaEffect) aa.effect = aaEffect;
    if (armed.endsSelfStatus === true) aa.endsSelfStatus = true;
    if (armed.turns !== undefined && armed.turns !== null) aa.turns = mechanicsInt(armed.turns, 'mechanics.armedAa.turns', 1, 99);
    const armedHp = mechanicsList(armed.hp, 'mechanics.armedAa.hp', 0, 100, false);
    if (armedHp) aa.hp = armedHp;
    if (armed.hpSource === 'max' || armed.hpSource === 'current' || armed.hpSource === 'missing' || armed.hpSource === 'bonus') aa.hpSource = armed.hpSource;
    if (armed.apPer100 !== undefined && armed.apPer100 !== null) {
      const per = armed.apPer100;
      if (typeof per !== 'number' || !Number.isFinite(per) || per < 0 || per > 100) throw new HttpError(400, 'mechanics.armedAa.apPer100 tiene que ser un número entre 0 y 100');
      aa.apPer100 = per;
    }
    if (armed.explodeFromLevel !== undefined && armed.explodeFromLevel !== null) aa.explodeFromLevel = mechanicsInt(armed.explodeFromLevel, 'mechanics.armedAa.explodeFromLevel', 1, 20);
    if (armed.charges !== undefined && armed.charges !== null) aa.charges = mechanicsInt(armed.charges, 'mechanics.armedAa.charges', 1, 9);
    if (armed.effectOnLastCharge === false) aa.effectOnLastCharge = false;
    if (armed.applyDamageOnUse === true) aa.applyDamageOnUse = true;
    if (!aa.ad && !aa.ap && !aa.effectName && !aa.effect && !aa.hp && aa.apPer100 == null) throw new HttpError(400, 'mechanics.armedAa: pon daño, % de vida o un estado');
    out.armedAa = aa;
  }
  if (source.armArmedAa === true) out.armArmedAa = true;
  const shred = mechanicsObject(source.resistShred, 'mechanics.resistShred');
  if (shred) {
    const pct = mechanicsList(shred.pct, 'mechanics.resistShred.pct', 1, 99, false);
    if (!pct) throw new HttpError(400, 'mechanics.resistShred.pct: pon el % por rango');
    const resistShred: NonNullable<ChampionAbilityMechanics['resistShred']> = { pct, turns: mechanicsInt(shred.turns, 'mechanics.resistShred.turns', 1, 99) };
    if (shred.armor === false) resistShred.armor = false;
    if (shred.mr === false) resistShred.mr = false;
    out.resistShred = resistShred;
  }
  const aaOnHit = mechanicsObject(source.aaOnHit, 'mechanics.aaOnHit');
  if (aaOnHit) {
    const onHit: NonNullable<ChampionAbilityMechanics['aaOnHit']> = {};
    const hp = mechanicsList(aaOnHit.hp, 'mechanics.aaOnHit.hp', 0, 100, false);
    if (hp) onHit.hp = hp;
    if (aaOnHit.hpSource === 'max' || aaOnHit.hpSource === 'current' || aaOnHit.hpSource === 'missing' || aaOnHit.hpSource === 'bonus') onHit.hpSource = aaOnHit.hpSource;
    if (aaOnHit.apPer100 !== undefined && aaOnHit.apPer100 !== null) {
      const per = typeof aaOnHit.apPer100 === 'number' ? aaOnHit.apPer100 : Number(aaOnHit.apPer100);
      if (!Number.isFinite(per) || per < 0 || per > 100) throw new HttpError(400, 'mechanics.aaOnHit.apPer100 tiene que ser un número entre 0 y 100');
      onHit.apPer100 = per;
    }
    if (typeof aaOnHit.type === 'string' && aaOnHit.type.trim()) onHit.type = aaOnHit.type.trim().slice(0, 40);
    const ad = mechanicsList(aaOnHit.ad, 'mechanics.aaOnHit.ad', 0, 10, false);
    if (ad) onHit.ad = ad;
    if (aaOnHit.adSource === 'total' || aaOnHit.adSource === 'bonus') onHit.adSource = aaOnHit.adSource;
    const onHitAp = mechanicsList(aaOnHit.ap, 'mechanics.aaOnHit.ap', 0, 10, false);
    if (onHitAp) onHit.ap = onHitAp;
    if (aaOnHit.apSource === 'total' || aaOnHit.apSource === 'bonus') onHit.apSource = aaOnHit.apSource;
    if (aaOnHit.always === true) onHit.always = true;
    const aaHitStacks = mechanicsObject(aaOnHit.perTargetStacks, 'mechanics.aaOnHit.perTargetStacks');
    if (aaHitStacks) {
      const perTarget: { turns: number; max?: number } = { turns: mechanicsInt(aaHitStacks.turns, 'mechanics.aaOnHit.perTargetStacks.turns', 1, 99) };
      if (aaHitStacks.max !== undefined && aaHitStacks.max !== null) perTarget.max = mechanicsInt(aaHitStacks.max, 'mechanics.aaOnHit.perTargetStacks.max', 1, 99);
      onHit.perTargetStacks = perTarget;
    }
    if (!onHit.hp && onHit.apPer100 == null && !onHit.ad && !onHit.ap) throw new HttpError(400, 'mechanics.aaOnHit: pon el % de vida, el % por 100 AP o el ratio de AD/AP');
    out.aaOnHit = onHit;
  }
  const costStacks = mechanicsObject(source.costStacks, 'mechanics.costStacks');
  if (costStacks) {
    out.costStacks = {
      amount: mechanicsInt(costStacks.amount, 'mechanics.costStacks.amount', 1, 999),
      turns: mechanicsInt(costStacks.turns, 'mechanics.costStacks.turns', 1, 99),
      max: mechanicsInt(costStacks.max, 'mechanics.costStacks.max', 1, 99),
    };
  }
  const death = mechanicsObject(source.deathBurst, 'mechanics.deathBurst');
  if (death) {
    const burst: NonNullable<ChampionAbilityMechanics['deathBurst']> = { turns: mechanicsInt(death.turns, 'mechanics.deathBurst.turns', 1, 99) };
    if (typeof death.name === 'string' && death.name.trim()) burst.name = death.name.trim().slice(0, 80);
    if (typeof death.stat === 'string' && death.stat.trim()) {
      if (!(SHEET_STAT_KEYS as readonly string[]).includes(death.stat)) throw new HttpError(400, 'mechanics.deathBurst.stat no es una stat de la ficha');
      burst.stat = death.stat;
    }
    if (death.pct !== undefined && death.pct !== null) {
      const pct = typeof death.pct === 'number' ? death.pct : Number(death.pct);
      if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 999) throw new HttpError(400, 'mechanics.deathBurst.pct tiene que ser un número distinto de 0 (máx. 999)');
      burst.pct = pct;
    }
    if (death.amount !== undefined && death.amount !== null) burst.amount = mechanicsInt(death.amount, 'mechanics.deathBurst.amount', -999, 999);
    out.deathBurst = burst;
  }
  const low = mechanicsObject(source.damageLowHp, 'mechanics.damageLowHp');
  if (low) {
    const multiplier = typeof low.multiplier === 'number' ? low.multiplier : Number(low.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) throw new HttpError(400, 'mechanics.damageLowHp.multiplier tiene que ser un número entre 0 (no incluido) y 10');
    const damageLowHp: NonNullable<ChampionAbilityMechanics['damageLowHp']> = {
      belowHpPct: mechanicsInt(low.belowHpPct, 'mechanics.damageLowHp.belowHpPct', 1, 100),
      multiplier,
    };
    if (low.missingMaxBonusPct !== undefined && low.missingMaxBonusPct !== null) {
      damageLowHp.missingMaxBonusPct = mechanicsInt(low.missingMaxBonusPct, 'mechanics.damageLowHp.missingMaxBonusPct', 1, 200);
    }
    out.damageLowHp = damageLowHp;
  }
  const onAbilityUse = mechanicsObject(source.onAbilityUse, 'mechanics.onAbilityUse');
  if (onAbilityUse) {
    const attackSpeed = mechanicsList(onAbilityUse.attackSpeed, 'mechanics.onAbilityUse.attackSpeed', 0, 999, false);
    out.onAbilityUse = { turns: mechanicsInt(onAbilityUse.turns, 'mechanics.onAbilityUse.turns', 1, 99) };
    if (attackSpeed) out.onAbilityUse.attackSpeed = attackSpeed;
  }
  const resetShots = mechanicsObject(source.resetSectorShots, 'mechanics.resetSectorShots');
  if (resetShots) {
    const from = typeof resetShots.from === 'string' ? resetShots.from.trim().slice(0, 80) : '';
    if (!from) throw new HttpError(400, 'mechanics.resetSectorShots.from: pon el nombre de la habilidad');
    out.resetSectorShots = { from, count: mechanicsInt(resetShots.count, 'mechanics.resetSectorShots.count', 1, 8) };
    if (resetShots.requiresChampionHit === true) out.resetSectorShots.requiresChampionHit = true;
  }
  const strikes = mechanicsObject(source.strikes, 'mechanics.strikes');
  if (strikes) {
    const count = mechanicsList(strikes.count, 'mechanics.strikes.count', 1, 20, true);
    if (!count) throw new HttpError(400, 'mechanics.strikes.count: pon el número de golpes');
    out.strikes = { count };
    if (strikes.perBonusAtkSpe !== undefined && strikes.perBonusAtkSpe !== null) out.strikes.perBonusAtkSpe = mechanicsInt(strikes.perBonusAtkSpe, 'mechanics.strikes.perBonusAtkSpe', 1, 200);
  }
  const mark = mechanicsObject(source.mark, 'mechanics.mark');
  if (mark) {
    const parsed: NonNullable<ChampionAbilityMechanics['mark']> = { turns: mechanicsInt(mark.turns, 'mechanics.mark.turns', 1, 99) };
    if (mark.detonateOn === 'aa' || mark.detonateOn === 'ability' || mark.detonateOn === 'both') parsed.detonateOn = mark.detonateOn;
    if (mark.damageOnDetonate === false) parsed.damageOnDetonate = false;
    else parsed.damageOnDetonate = true;
    if (mark.applyOnAbilityHit === true) parsed.applyOnAbilityHit = true;
    if (typeof mark.name === 'string' && mark.name.trim()) parsed.name = mark.name.trim().slice(0, 80);
    const refund = mechanicsObject(mark.refundMana, 'mechanics.mark.refundMana');
    if (refund) {
      const refundMana: NonNullable<NonNullable<ChampionAbilityMechanics['mark']>['refundMana']> = {};
      const flat = mechanicsList(refund.flat, 'mechanics.mark.refundMana.flat', 0, 999, false);
      if (flat) refundMana.flat = flat;
      if (refund.refundCost === true) refundMana.refundCost = true;
      if (refundMana.flat || refundMana.refundCost) parsed.refundMana = refundMana;
    }
    out.mark = parsed;
  }
  if (source.cleanse === true) out.cleanse = true;
  if (source.returnStrike && typeof source.returnStrike === 'object' && !Array.isArray(source.returnStrike)) {
    const ret = source.returnStrike as Record<string, unknown>;
    if (ret.type === 'true' || ret.type === 'magic' || ret.type === 'physical') out.returnStrike = { type: ret.type };
    else throw new HttpError(400, 'mechanics.returnStrike.type tiene que ser true, magic o physical');
  }
  const takedownHeal = mechanicsObject(source.takedownHeal, 'mechanics.takedownHeal');
  if (takedownHeal) {
    const heal: NonNullable<ChampionAbilityMechanics['takedownHeal']> = {};
    const flat = mechanicsList(takedownHeal.flat, 'mechanics.takedownHeal.flat', 0, 100000, false);
    if (flat) heal.flat = flat;
    if (takedownHeal.flatByLevel === true) heal.flatByLevel = true;
    if (Array.isArray(takedownHeal.ratios) && takedownHeal.ratios.length) {
      const ratios: { stat: CastPoolStat; values: number[] }[] = [];
      for (const [index, entry] of takedownHeal.ratios.entries()) {
        const row = mechanicsObject(entry, `mechanics.takedownHeal.ratios[${index}]`);
        if (!row) continue;
        const stat = typeof row.stat === 'string' ? row.stat.trim() : '';
        if (stat !== 'hp' && stat !== 'ap' && stat !== 'ad' && stat !== 'bonusAd' && stat !== 'bonusAp') throw new HttpError(400, `mechanics.takedownHeal.ratios[${index}].stat no válido`);
        const values = mechanicsList(row.values, `mechanics.takedownHeal.ratios[${index}].values`, 0, 1000, false);
        if (!values) throw new HttpError(400, `mechanics.takedownHeal.ratios[${index}].values: pon los valores`);
        ratios.push({ stat: stat as CastPoolStat, values });
      }
      if (ratios.length) heal.ratios = ratios;
    }
    if (takedownHeal.champion === true) heal.champion = true;
    if (heal.flat || heal.ratios) out.takedownHeal = heal;
  }
  if (Array.isArray(source.levelThresholds) && source.levelThresholds.length) {
    const list: NonNullable<ChampionAbilityMechanics['levelThresholds']> = [];
    for (const [index, entry] of source.levelThresholds.entries()) {
      const row = mechanicsObject(entry, `mechanics.levelThresholds[${index}]`);
      if (!row) continue;
      const parsed: NonNullable<ChampionAbilityMechanics['levelThresholds']>[number] = { level: mechanicsInt(row.level, `mechanics.levelThresholds[${index}].level`, 1, 20) };
      if (typeof row.name === 'string' && row.name.trim()) parsed.name = row.name.trim().slice(0, 80);
      if (row.rangeBonus !== undefined && row.rangeBonus !== null) parsed.rangeBonus = mechanicsInt(row.rangeBonus, `mechanics.levelThresholds[${index}].rangeBonus`, 0, 20);
      if (row.permanentMaxStacks === true) parsed.permanentMaxStacks = true;
      const wave = mechanicsObject(row.aaWave, `mechanics.levelThresholds[${index}].aaWave`);
      if (wave) {
        const aaWave: NonNullable<NonNullable<ChampionAbilityMechanics['levelThresholds']>[number]['aaWave']> = {};
        if (wave.type === 'magic' || wave.type === 'true' || wave.type === 'physical') aaWave.type = wave.type;
        const wad = mechanicsList(wave.ad, `mechanics.levelThresholds[${index}].aaWave.ad`, 0, 10, false);
        const wap = mechanicsList(wave.ap, `mechanics.levelThresholds[${index}].aaWave.ap`, 0, 10, false);
        if (wad) aaWave.ad = wad;
        if (wap) aaWave.ap = wap;
        if (wave.adSource === 'total' || wave.adSource === 'bonus') aaWave.adSource = wave.adSource;
        if (wave.apSource === 'total' || wave.apSource === 'bonus') aaWave.apSource = wave.apSource;
        if (wave.requiresMaxStacks === true) aaWave.requiresMaxStacks = true;
        parsed.aaWave = aaWave;
      }
      list.push(parsed);
    }
    if (list.length) out.levelThresholds = list;
  }
  const protect = mechanicsObject(source.protect, 'mechanics.protect');
  if (protect) {
    const pct = mechanicsList(protect.damageReductionPct, 'mechanics.protect.damageReductionPct', 0, 100, false);
    if (!pct) throw new HttpError(400, 'mechanics.protect.damageReductionPct: pon el % por rango');
    const parsed: NonNullable<ChampionAbilityMechanics['protect']> = { turns: mechanicsInt(protect.turns, 'mechanics.protect.turns', 1, 99), damageReductionPct: pct };
    if (typeof protect.name === 'string' && protect.name.trim()) parsed.name = protect.name.trim().slice(0, 80);
    if (protect.target === 'self' || protect.target === 'ally' || protect.target === 'allyOrSelf') parsed.target = protect.target;
    out.protect = parsed;
  }
  const combatTraits = mechanicsObject(source.combatTraits, 'mechanics.combatTraits');
  if (combatTraits) out.combatTraits = parseCombatTraits(combatTraits, 'mechanics.combatTraits');
  return Object.keys(out).length ? out : undefined;
}

function parseCombatTraits(value: unknown, field: string): ChampionCombatTraits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser un objeto`);
  const source = value as Record<string, unknown>;
  const out: ChampionCombatTraits = {};
  const optText = (raw: unknown, name: string, max = 200): string | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') throw new HttpError(400, `${name} tiene que ser un texto`);
    const text = raw.trim();
    if (!text) return undefined;
    if (text.length > max) throw new HttpError(400, `${name} admite como máximo ${max} caracteres`);
    return text;
  };
  const optNum = (raw: unknown, name: string, min: number, max: number): number | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) throw new HttpError(400, `${name} tiene que ser un número entre ${min} y ${max}`);
    return raw;
  };
  const optInt = (raw: unknown, name: string, min: number, max: number): number | undefined => {
    const n = optNum(raw, name, min, max);
    if (n == null) return undefined;
    if (!Number.isInteger(n)) throw new HttpError(400, `${name} tiene que ser un entero`);
    return n;
  };
  const optQuarter = (raw: unknown, name: string, min: number, max: number): number | undefined => {
    const n = optNum(raw, name, min, max);
    if (n == null) return undefined;
    const cleaned = Math.round(n * 4) / 4;
    if (Math.abs(cleaned - n) > 1e-6) throw new HttpError(400, `${name} tiene que ir de 0,25 en 0,25`);
    return cleaned;
  };
  if (source.capture !== undefined && source.capture !== null) {
    const cap = mechanicsObject(source.capture, `${field}.capture`);
    if (!cap) throw new HttpError(400, `${field}.capture tiene que ser un objeto`);
    const name = optText(cap.name, `${field}.capture.name`, 80);
    out.capture = name ? { name } : {};
  }
  if (source.combatStart !== undefined && source.combatStart !== null) {
    const raw = mechanicsObject(source.combatStart, `${field}.combatStart`);
    if (!raw) throw new HttpError(400, `${field}.combatStart tiene que ser un objeto`);
    const statusName = optText(raw.statusName, `${field}.combatStart.statusName`, 80);
    if (!statusName) throw new HttpError(400, `${field}.combatStart.statusName es obligatorio`);
    out.combatStart = { statusName, turns: mechanicsInt(raw.turns, `${field}.combatStart.turns`, 1, 99) };
    if (raw.pick === 'enemy') out.combatStart.pick = 'enemy';
    const count = optInt(raw.count, `${field}.combatStart.count`, 1, 10);
    if (count) out.combatStart.count = count;
  }
  if (source.combatEntry !== undefined && source.combatEntry !== null) {
    const raw = mechanicsObject(source.combatEntry, `${field}.combatEntry`);
    if (!raw) throw new HttpError(400, `${field}.combatEntry tiene que ser un objeto`);
    const statusName = optText(raw.statusName, `${field}.combatEntry.statusName`, 80);
    if (!statusName) throw new HttpError(400, `${field}.combatEntry.statusName es obligatorio`);
    const appliesTo = raw.appliesTo;
    if (appliesTo !== 'allies' && appliesTo !== 'self' && appliesTo !== 'enemies') throw new HttpError(400, `${field}.combatEntry.appliesTo tiene que ser allies, self o enemies`);
    const entry: NonNullable<ChampionCombatTraits['combatEntry']> = { statusName, appliesTo };
    const turns = optInt(raw.turns, `${field}.combatEntry.turns`, 1, 99);
    if (turns) entry.turns = turns;
    out.combatEntry = entry;
  }
  if (source.tough !== undefined && source.tough !== null) {
    const raw = mechanicsObject(source.tough, `${field}.tough`);
    if (!raw) throw new HttpError(400, `${field}.tough tiene que ser un objeto`);
    const tough: NonNullable<ChampionCombatTraits['tough']> = { flat: mechanicsInt(raw.flat, `${field}.tough.flat`, 1, 99) };
    const name = optText(raw.name, `${field}.tough.name`, 80);
    if (name) tough.name = name;
    if (raw.auraAllies === true) tough.auraAllies = true;
    if (raw.onAllySurvive !== undefined && raw.onAllySurvive !== null) {
      const hit = mechanicsObject(raw.onAllySurvive, `${field}.tough.onAllySurvive`);
      if (!hit) throw new HttpError(400, `${field}.tough.onAllySurvive tiene que ser un objeto`);
      const atkSpe = optInt(hit.atkSpe, `${field}.tough.onAllySurvive.atkSpe`, -20, 20);
      const ac = optInt(hit.ac, `${field}.tough.onAllySurvive.ac`, -20, 20);
      const mr = optQuarter(hit.mr, `${field}.tough.onAllySurvive.mr`, -20, 20);
      tough.onAllySurvive = { ...(atkSpe != null ? { atkSpe } : {}), ...(ac != null ? { ac } : {}), ...(mr != null ? { mr } : {}) };
    }
    out.tough = tough;
  }
  if (source.aura !== undefined && source.aura !== null) {
    const raw = mechanicsObject(source.aura, `${field}.aura`);
    if (!raw) throw new HttpError(400, `${field}.aura tiene que ser un objeto`);
    const aura: NonNullable<ChampionCombatTraits['aura']> = { range: mechanicsInt(raw.range, `${field}.aura.range`, 1, 20) };
    const label = optText(raw.label, `${field}.aura.label`, 80);
    if (label) aura.label = label;
    const abSpe = optInt(raw.abSpe, `${field}.aura.abSpe`, -10, 10);
    if (abSpe != null) aura.abSpe = abSpe;
    const minAbSpe = optInt(raw.minAbSpe, `${field}.aura.minAbSpe`, 0, 10);
    if (minAbSpe != null) aura.minAbSpe = minAbSpe;
    const manaCost = optInt(raw.manaCost, `${field}.aura.manaCost`, 1, 99);
    if (manaCost != null) aura.manaCost = manaCost;
    const manaCostPct = optInt(raw.manaCostPct, `${field}.aura.manaCostPct`, 1, 500);
    if (manaCostPct != null) aura.manaCostPct = manaCostPct;
    out.aura = aura;
  }
  if (source.deathNotice !== undefined && source.deathNotice !== null) {
    const raw = mechanicsObject(source.deathNotice, `${field}.deathNotice`);
    if (!raw) throw new HttpError(400, `${field}.deathNotice tiene que ser un objeto`);
    const notice = optText(raw.text, `${field}.deathNotice.text`, 400);
    if (!notice) throw new HttpError(400, `${field}.deathNotice.text es obligatorio`);
    out.deathNotice = { text: notice };
  }
  if (source.challenge !== undefined && source.challenge !== null) {
    const raw = mechanicsObject(source.challenge, `${field}.challenge`);
    if (!raw) throw new HttpError(400, `${field}.challenge tiene que ser un objeto`);
    const challenge: NonNullable<ChampionCombatTraits['challenge']> = {};
    const name = optText(raw.statusName, `${field}.challenge.statusName`, 80);
    if (name) challenge.statusName = name;
    const turns = optInt(raw.turns, `${field}.challenge.turns`, 1, 99);
    if (turns) challenge.turns = turns;
    out.challenge = challenge;
  }
  if (source.aaMark !== undefined && source.aaMark !== null) {
    const raw = mechanicsObject(source.aaMark, `${field}.aaMark`);
    if (!raw) throw new HttpError(400, `${field}.aaMark tiene que ser un objeto`);
    const name = optText(raw.name, `${field}.aaMark.name`, 80);
    if (!name) throw new HttpError(400, `${field}.aaMark.name es obligatorio`);
    const mark: NonNullable<ChampionCombatTraits['aaMark']> = { name, max: mechanicsInt(raw.max, `${field}.aaMark.max`, 1, 20) };
    if (raw.consume === false) mark.consume = false;
    const damage = optInt(raw.damage, `${field}.aaMark.damage`, 1, 999);
    if (damage) mark.damage = damage;
    if (raw.damageType === 'physical' || raw.damageType === 'magic' || raw.damageType === 'true') mark.damageType = raw.damageType;
    const status = optText(raw.status, `${field}.aaMark.status`, 80);
    if (status) mark.status = status;
    const statusTurns = optInt(raw.statusTurns, `${field}.aaMark.statusTurns`, 1, 99);
    if (statusTurns) mark.statusTurns = statusTurns;
    out.aaMark = mark;
  }
  if (source.onEnemyUltimate !== undefined && source.onEnemyUltimate !== null) {
    const raw = mechanicsObject(source.onEnemyUltimate, `${field}.onEnemyUltimate`);
    if (!raw) throw new HttpError(400, `${field}.onEnemyUltimate tiene que ser un objeto`);
    const cfg: NonNullable<ChampionCombatTraits['onEnemyUltimate']> = {};
    if (raw.oncePerCombat === true) cfg.oncePerCombat = true;
    const atkSpe = optInt(raw.atkSpe, `${field}.onEnemyUltimate.atkSpe`, -20, 20);
    if (atkSpe != null) cfg.atkSpe = atkSpe;
    const ac = optInt(raw.ac, `${field}.onEnemyUltimate.ac`, -20, 20);
    if (ac != null) cfg.ac = ac;
    const mr = optQuarter(raw.mr, `${field}.onEnemyUltimate.mr`, -20, 20);
    if (mr != null) cfg.mr = mr;
    if (raw.taunt === true) cfg.taunt = true;
    const tauntName = optText(raw.tauntName, `${field}.onEnemyUltimate.tauntName`, 80);
    if (tauntName) cfg.tauntName = tauntName;
    const tauntTurns = optInt(raw.tauntTurns, `${field}.onEnemyUltimate.tauntTurns`, 1, 99);
    if (tauntTurns) cfg.tauntTurns = tauntTurns;
    const grantCharges = optInt(raw.grantCharges, `${field}.onEnemyUltimate.grantCharges`, 1, 20);
    if (grantCharges) cfg.grantCharges = grantCharges;
    const grantChargeTo = optText(raw.grantChargeTo, `${field}.onEnemyUltimate.grantChargeTo`, 80);
    if (grantChargeTo) cfg.grantChargeTo = grantChargeTo;
    out.onEnemyUltimate = cfg;
  }
  if (source.mrScalesWithHp !== undefined && source.mrScalesWithHp !== null) {
    const raw = mechanicsObject(source.mrScalesWithHp, `${field}.mrScalesWithHp`);
    if (!raw) throw new HttpError(400, `${field}.mrScalesWithHp tiene que ser un objeto`);
    const max = optQuarter(raw.max, `${field}.mrScalesWithHp.max`, 0, 99);
    const min = optQuarter(raw.min, `${field}.mrScalesWithHp.min`, 0, 99);
    if (max == null || min == null) throw new HttpError(400, `${field}.mrScalesWithHp necesita max y min`);
    if (min > max) throw new HttpError(400, `${field}.mrScalesWithHp.min no puede ser mayor que max`);
    out.mrScalesWithHp = { max, min };
  }
  if (source.formidable !== undefined && source.formidable !== null) {
    const raw = mechanicsObject(source.formidable, `${field}.formidable`);
    if (!raw) throw new HttpError(400, `${field}.formidable tiene que ser un objeto`);
    const hpPct = optNum(raw.hpPct, `${field}.formidable.hpPct`, 0.01, 100);
    if (hpPct == null) throw new HttpError(400, `${field}.formidable.hpPct es obligatorio`);
    out.formidable = { hpPct: Math.round(hpPct * 100) / 100 };
  }
  if (source.abilityDamageTaken !== undefined && source.abilityDamageTaken !== null) {
    const raw = mechanicsObject(source.abilityDamageTaken, `${field}.abilityDamageTaken`);
    if (!raw) throw new HttpError(400, `${field}.abilityDamageTaken tiene que ser un objeto`);
    const pct = optNum(raw.pct, `${field}.abilityDamageTaken.pct`, 0, 100);
    if (pct == null) throw new HttpError(400, `${field}.abilityDamageTaken.pct es obligatorio`);
    out.abilityDamageTaken = { pct: Math.round(pct * 100) / 100 };
  }
  if (source.guardAlly !== undefined && source.guardAlly !== null) {
    const raw = mechanicsObject(source.guardAlly, `${field}.guardAlly`);
    if (!raw) throw new HttpError(400, `${field}.guardAlly tiene que ser un objeto`);
    const guard: NonNullable<ChampionCombatTraits['guardAlly']> = { turns: mechanicsInt(raw.turns, `${field}.guardAlly.turns`, 1, 99) };
    const name = optText(raw.name, `${field}.guardAlly.name`, 80);
    if (name) guard.name = name;
    out.guardAlly = guard;
  }
  if (source.onAllyJoin !== undefined && source.onAllyJoin !== null) {
    const raw = mechanicsObject(source.onAllyJoin, `${field}.onAllyJoin`);
    if (!raw) throw new HttpError(400, `${field}.onAllyJoin tiene que ser un objeto`);
    const join: NonNullable<ChampionCombatTraits['onAllyJoin']> = {};
    const statusName = optText(raw.statusName, `${field}.onAllyJoin.statusName`, 80);
    if (statusName) join.statusName = statusName;
    const turns = optInt(raw.turns, `${field}.onAllyJoin.turns`, 1, 99);
    if (turns) join.turns = turns;
    if (raw.pick === 'enemy') join.pick = 'enemy';
    if (raw.challenge === true) join.challenge = true;
    out.onAllyJoin = join;
  }
  if (source.packTactics !== undefined && source.packTactics !== null) {
    const raw = mechanicsObject(source.packTactics, `${field}.packTactics`);
    if (!raw) throw new HttpError(400, `${field}.packTactics tiene que ser un objeto`);
    const hitBonus = optInt(raw.hitBonus, `${field}.packTactics.hitBonus`, 1, 20);
    if (hitBonus == null) throw new HttpError(400, `${field}.packTactics.hitBonus es obligatorio`);
    const pack: NonNullable<ChampionCombatTraits['packTactics']> = { hitBonus };
    const label = optText(raw.label, `${field}.packTactics.label`, 80);
    if (label) pack.label = label;
    out.packTactics = pack;
  }
  if (source.unstoppableVsLowerHp !== undefined && source.unstoppableVsLowerHp !== null) {
    if (source.unstoppableVsLowerHp === true) {
      out.unstoppableVsLowerHp = {};
    } else {
      const raw = mechanicsObject(source.unstoppableVsLowerHp, `${field}.unstoppableVsLowerHp`);
      if (!raw) throw new HttpError(400, `${field}.unstoppableVsLowerHp tiene que ser un objeto`);
      const name = optText(raw.name, `${field}.unstoppableVsLowerHp.name`, 80);
      out.unstoppableVsLowerHp = name ? { name } : {};
    }
  }
  if (source.trueSight !== undefined && source.trueSight !== null) {
    const raw = mechanicsObject(source.trueSight, `${field}.trueSight`);
    if (!raw) throw new HttpError(400, `${field}.trueSight tiene que ser un objeto`);
    const range = mechanicsInt(raw.range, `${field}.trueSight.range`, 1, 20);
    const sight: NonNullable<ChampionCombatTraits['trueSight']> = { range };
    const label = optText(raw.label, `${field}.trueSight.label`, 80);
    if (label) sight.label = label;
    out.trueSight = sight;
  }
  if (source.absorbAllyMagic !== undefined && source.absorbAllyMagic !== null) {
    const raw = mechanicsObject(source.absorbAllyMagic, `${field}.absorbAllyMagic`);
    if (!raw) throw new HttpError(400, `${field}.absorbAllyMagic tiene que ser un objeto`);
    const absorb: { chancePct?: number; name?: string } = {};
    const chancePct = optInt(raw.chancePct, `${field}.absorbAllyMagic.chancePct`, 1, 100);
    if (chancePct != null) absorb.chancePct = chancePct;
    const name = optText(raw.name, `${field}.absorbAllyMagic.name`, 80);
    if (name) absorb.name = name;
    if (absorb.chancePct == null) absorb.chancePct = 50;
    out.absorbAllyMagic = absorb;
  }
  if (!Object.keys(out).length) throw new HttpError(400, `${field} no tiene ningún rasgo`);
  return out;
}


/** Fase alternativa de una habilidad (Q de Aatrox, Riven, básicas de Hwei…). */
export type ChampionAbilityVariant = {
  /** Nombre de la fase. Ausente = «Fase N». */
  name?: string;
  description?: string;
  cost?: string;
  resource?: ResourceId;
  /** Campos de daño que cambian; los ausentes heredan de la base. */
  damage?: ChampionAbilityDamage;
  /** Si está, sustituye la lista de efectos de la base. */
  effect?: ChampionAbilityEffect[];
  cooldown?: number;
  effectDuration?: number;
  /** Aquí self se guarda explícito para poder sobrescribir una base enemy. */
  effectTarget?: 'self' | 'enemy';
  effectName?: string;
  area?: AreaPattern;
  requiresStacks?: { from: string; count: number; consume?: boolean };
  stackDamage?: { from: string; pct: number[]; type?: 'physical' | 'magic' | 'true'; byLevel?: boolean };
};

const ABILITY_MAX_VARIANTS = 12;

export type ChampionAbilityPatch = {
  slot: ChampionSlot;
  ability: ChampionAbility;
};

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser un texto`);
  const text = value.trim();
  return text || undefined;
}

function finiteNumbers(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new HttpError(400, `${field} tiene que ser una lista de números`);
  }
  return value.length ? value : undefined;
}

function parseDamage(value: unknown): ChampionAbilityDamage | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'damage tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const damage: ChampionAbilityDamage = {};
  const type = optionalText(source.type, 'damage.type');
  if (type) damage.type = type;
  const ap = finiteNumbers(source.ap, 'damage.ap');
  const ad = finiteNumbers(source.ad, 'damage.ad');
  if (ap) damage.ap = ap;
  if (ad) damage.ad = ad;
  for (const key of ['adSource', 'apSource'] as const) {
    if (source[key] === undefined) continue; // Legacy abilities default to total.
    if (source[key] !== 'total' && source[key] !== 'bonus') {
      throw new HttpError(400, `damage.${key} tiene que ser total o bonus`);
    }
    damage[key] = source[key];
  }
  if (source.damageBonus !== undefined) {
    if (typeof source.damageBonus !== 'number' || !Number.isFinite(source.damageBonus)) {
      throw new HttpError(400, 'damage.damageBonus tiene que ser un número');
    }
    damage.damageBonus = source.damageBonus;
  }
  const hp = finiteNumbers(source.hp, 'damage.hp');
  if (hp) damage.hp = hp;
  if (source.hpSource !== undefined && source.hpSource !== null && source.hpSource !== '') {
    if (source.hpSource !== 'max' && source.hpSource !== 'current' && source.hpSource !== 'missing' && source.hpSource !== 'bonus') {
      throw new HttpError(400, 'damage.hpSource tiene que ser max, current, missing o bonus');
    }
    damage.hpSource = source.hpSource;
  }
  if (source.hpFrom !== undefined && source.hpFrom !== null && source.hpFrom !== '') {
    if (source.hpFrom !== 'target' && source.hpFrom !== 'self') throw new HttpError(400, 'damage.hpFrom tiene que ser target o self');
    damage.hpFrom = source.hpFrom;
  }
  if (source.hpAdPer100 !== undefined && source.hpAdPer100 !== null) {
    const per = source.hpAdPer100;
    if (typeof per !== 'number' || !Number.isFinite(per) || per < 0 || per > 100) throw new HttpError(400, 'damage.hpAdPer100 tiene que ser un número entre 0 y 100');
    damage.hpAdPer100 = per;
  }
  if (source.hpAdPer !== undefined && source.hpAdPer !== null) {
    const step = source.hpAdPer;
    if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0 || step > 1000) {
      throw new HttpError(400, 'damage.hpAdPer tiene que ser un número mayor que 0 y como máximo 1000');
    }
    damage.hpAdPer = step;
  }
  if (source.hpAdSource === 'total' || source.hpAdSource === 'bonus' || source.hpAdSource === 'itemDiceAvg') {
    damage.hpAdSource = source.hpAdSource;
  }
  return Object.keys(damage).length ? damage : undefined;
}

function parseEffects(value: unknown): ChampionAbilityEffect[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, 'effect tiene que ser una lista');
  const effects: ChampionAbilityEffect[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, 'Cada efecto tiene que ser un objeto');
    }
    const source = item as Record<string, unknown>;
    const name = optionalText(source.name, 'effect.name');
    if (!name) throw new HttpError(400, 'Cada efecto necesita un nombre');
    const effect: ChampionAbilityEffect = { name };
    const values = finiteNumbers(source.values, 'effect.values');
    const duration = finiteNumbers(source.duration, 'effect.duration');
    if (values) effect.values = values;
    if (duration) effect.duration = duration;
    effects.push(effect);
  }
  return effects.length ? effects : undefined;
}

export function parseChampionAbilityPatch(body: unknown): ChampionAbilityPatch {
  const source = asObject(body);
  if (typeof source.slot !== 'string' || !CHAMPION_SLOTS.includes(source.slot as ChampionSlot)) {
    throw new HttpError(400, 'slot tiene que ser P, Q, W, E o R');
  }
  if (!source.ability || typeof source.ability !== 'object' || Array.isArray(source.ability)) {
    throw new HttpError(400, 'ability tiene que ser un objeto');
  }
  const abilitySource = source.ability as Record<string, unknown>;
  const name = optionalText(abilitySource.name, 'name');
  if (!name) throw new HttpError(400, 'La habilidad necesita un nombre');

  const ability: ChampionAbility = { name };
  const description = optionalText(abilitySource.description, 'description');
  const cost = optionalText(abilitySource.cost, 'cost');
  if (description) ability.description = description;
  if (cost) ability.cost = cost;
  if ('learned' in abilitySource) {
    if (typeof abilitySource.learned !== 'boolean') {
      throw new HttpError(400, 'learned tiene que ser verdadero o falso');
    }
    ability.learned = abilitySource.learned;
  }
  if ('damage' in abilitySource) {
    const damage = parseDamage(abilitySource.damage);
    if (damage) ability.damage = damage;
  }
  if ('effect' in abilitySource) {
    const effect = parseEffects(abilitySource.effect);
    if (effect) ability.effect = effect;
  }
  if ('hasStacks' in abilitySource) {
    if (typeof abilitySource.hasStacks !== 'boolean') throw new HttpError(400, 'hasStacks tiene que ser true o false');
    ability.hasStacks = abilitySource.hasStacks;
  }
  if ('appliesOnHit' in abilitySource && abilitySource.appliesOnHit !== undefined && abilitySource.appliesOnHit !== null) {
    if (typeof abilitySource.appliesOnHit !== 'boolean') throw new HttpError(400, 'appliesOnHit tiene que ser true o false');
    if (abilitySource.appliesOnHit) ability.appliesOnHit = true;
  }
  if ('maxStacks' in abilitySource && abilitySource.maxStacks !== undefined && abilitySource.maxStacks !== null) {
    if (typeof abilitySource.maxStacks !== 'number' || !Number.isInteger(abilitySource.maxStacks) || abilitySource.maxStacks < 1 || abilitySource.maxStacks > 999) {
      throw new HttpError(400, 'maxStacks tiene que ser un entero entre 1 y 999');
    }
    ability.maxStacks = abilitySource.maxStacks;
  }
  if ('cooldown' in abilitySource && abilitySource.cooldown !== undefined && abilitySource.cooldown !== null) {
    if (typeof abilitySource.cooldown !== 'number' || !Number.isInteger(abilitySource.cooldown) || abilitySource.cooldown < 1 || abilitySource.cooldown > 999) {
      throw new HttpError(400, 'cooldown tiene que ser un entero entre 1 y 999');
    }
    ability.cooldown = abilitySource.cooldown;
  }
  if ('effectDuration' in abilitySource && abilitySource.effectDuration !== undefined && abilitySource.effectDuration !== null) {
    if (typeof abilitySource.effectDuration !== 'number' || !Number.isInteger(abilitySource.effectDuration) || abilitySource.effectDuration < 1 || abilitySource.effectDuration > 999) {
      throw new HttpError(400, 'effectDuration tiene que ser un entero entre 1 y 999');
    }
    ability.effectDuration = abilitySource.effectDuration;
  }
  if ('effectTarget' in abilitySource && abilitySource.effectTarget !== undefined && abilitySource.effectTarget !== null) {
    if (abilitySource.effectTarget !== 'self' && abilitySource.effectTarget !== 'enemy') {
      throw new HttpError(400, 'effectTarget tiene que ser self o enemy');
    }
    if (abilitySource.effectTarget === 'enemy') ability.effectTarget = 'enemy';
  }
  if ('effectName' in abilitySource && abilitySource.effectName !== undefined && abilitySource.effectName !== null) {
    const effectName = boundedText(abilitySource.effectName, 'effectName', 80);
    if (effectName) ability.effectName = effectName;
  }
  if ('resource' in abilitySource && abilitySource.resource !== undefined && abilitySource.resource !== null && abilitySource.resource !== '') {
    if (!isResourceId(abilitySource.resource)) {
      throw new HttpError(400, 'resource tiene que ser mana, energia, vida, furia, calor, ferocidad, coraje, sangre, escudo, concentracion, ninguno u otro');
    }
    ability.resource = abilitySource.resource;
  }
  if ('variants' in abilitySource && abilitySource.variants !== undefined && abilitySource.variants !== null) {
    const variants = parseAbilityVariants(abilitySource.variants);
    if (variants) ability.variants = variants;
  }
  if ('phaseMode' in abilitySource && abilitySource.phaseMode !== undefined && abilitySource.phaseMode !== null) {
    if (abilitySource.phaseMode !== 'sequential' && abilitySource.phaseMode !== 'choose') {
      throw new HttpError(400, 'phaseMode tiene que ser sequential o choose');
    }
    if (abilitySource.phaseMode === 'choose') ability.phaseMode = 'choose';
  }
  if ('area' in abilitySource) {
    const area = parseAreaPattern(abilitySource.area);
    if (area) ability.area = area;
  }
  if ('mechanics' in abilitySource) {
    const mechanics = parseAbilityMechanics(abilitySource.mechanics);
    if (mechanics) ability.mechanics = mechanics;
  }
  return { slot: source.slot as ChampionSlot, ability };
}

function optionalTurns(source: Record<string, unknown>, key: string, field: string): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 999) {
    throw new HttpError(400, `${field} tiene que ser un entero entre 1 y 999`);
  }
  return value;
}

function parseAbilityVariants(value: unknown): ChampionAbilityVariant[] | undefined {
  if (!Array.isArray(value)) throw new HttpError(400, 'variants tiene que ser una lista');
  if (value.length > ABILITY_MAX_VARIANTS) {
    throw new HttpError(400, `Como máximo ${ABILITY_MAX_VARIANTS} variantes por habilidad`);
  }
  const variants: ChampionAbilityVariant[] = [];
  value.forEach((item, index) => {
    const label = `variants[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, `${label} tiene que ser un objeto`);
    }
    const source = item as Record<string, unknown>;
    const variant: ChampionAbilityVariant = {};
    const name = boundedText(source.name, `${label}.name`, 80);
    if (name) variant.name = name;
    const description = optionalText(source.description, `${label}.description`);
    if (description) variant.description = description;
    const cost = optionalText(source.cost, `${label}.cost`);
    if (cost) variant.cost = cost;
    if (source.resource !== undefined && source.resource !== null && source.resource !== '') {
      if (!isResourceId(source.resource)) throw new HttpError(400, `${label}.resource no es un recurso válido`);
      variant.resource = source.resource;
    }
    if (source.damage !== undefined && source.damage !== null) {
      const damage = parseDamage(source.damage);
      if (damage) variant.damage = damage;
    }
    if (source.effect !== undefined && source.effect !== null) {
      const effect = parseEffects(source.effect);
      if (effect) variant.effect = effect;
    }
    const cooldown = optionalTurns(source, 'cooldown', `${label}.cooldown`);
    if (cooldown !== undefined) variant.cooldown = cooldown;
    const effectDuration = optionalTurns(source, 'effectDuration', `${label}.effectDuration`);
    if (effectDuration !== undefined) variant.effectDuration = effectDuration;
    if (source.effectTarget !== undefined && source.effectTarget !== null && source.effectTarget !== '') {
      if (source.effectTarget !== 'self' && source.effectTarget !== 'enemy') {
        throw new HttpError(400, `${label}.effectTarget tiene que ser self o enemy`);
      }
      variant.effectTarget = source.effectTarget;
    }
    const effectName = boundedText(source.effectName, `${label}.effectName`, 80);
    if (effectName) variant.effectName = effectName;
    if ('area' in source) {
      const area = parseAreaPattern(source.area, `${label}.area`);
      if (area) variant.area = area;
    }
    const requiresStacks = mechanicsObject(source.requiresStacks, `${label}.requiresStacks`);
    if (requiresStacks) {
      const from = typeof requiresStacks.from === 'string' ? requiresStacks.from.trim().slice(0, 80) : '';
      if (!from) throw new HttpError(400, `${label}.requiresStacks.from: pon el nombre de la habilidad que tiene las cargas`);
      variant.requiresStacks = { from, count: mechanicsInt(requiresStacks.count, `${label}.requiresStacks.count`, 1, 999) };
      if (requiresStacks.consume === true) variant.requiresStacks.consume = true;
    }
    const variantStackDamage = mechanicsObject(source.stackDamage, `${label}.stackDamage`);
    if (variantStackDamage) {
      const from = typeof variantStackDamage.from === 'string' ? variantStackDamage.from.trim().slice(0, 80) : '';
      if (!from) throw new HttpError(400, `${label}.stackDamage.from: pon el nombre de la habilidad que tiene las cargas`);
      const pct = mechanicsList(variantStackDamage.pct, `${label}.stackDamage.pct`, 0, 999, false);
      if (!pct) throw new HttpError(400, `${label}.stackDamage.pct: pon el % por rango`);
      variant.stackDamage = { from, pct };
      if (variantStackDamage.type !== undefined && variantStackDamage.type !== null && variantStackDamage.type !== 'magic') {
        if (variantStackDamage.type !== 'physical' && variantStackDamage.type !== 'true') throw new HttpError(400, `${label}.stackDamage.type tiene que ser physical, magic o true`);
        variant.stackDamage.type = variantStackDamage.type;
      }
      if (variantStackDamage.byLevel === true) variant.stackDamage.byLevel = true;
    }
    variants.push(variant);
  });
  return variants.length ? variants : undefined;
}

export type ChampionFieldsPatch = {
  level?: number;
  /** Id de la tabla de rol (colección roles), p. ej. "luchador-ad". */
  roleId?: string;
  /** Categoría del campeón (Luchador, Mago...). */
  role?: string;
  image?: string;
  background?: string | null;
  equipamiento?: string[];
  /** Build deseada (lista de nombres). Ausente en campeones antiguos. */
  build?: string[];
  active?: boolean;
  /** null quita el recurso. */
  resource?: ResourceId | null;
};

const CHAMPION_LEVEL_MIN = 1;
const CHAMPION_LEVEL_MAX = 20;
const CHAMPION_BACKGROUND_LIMIT = 2000;
const CHAMPION_EQUIP_SLOTS = 7;

/** Nivel, fondo o equipo del campeón (ficha DM). */
export function parseChampionFieldsPatch(body: unknown): ChampionFieldsPatch {
  const source = asObject(body);
  const patch: ChampionFieldsPatch = {};
  let touched = false;

  if ('level' in source) {
    if (typeof source.level !== 'number' || !Number.isInteger(source.level)) {
      throw new HttpError(400, 'level tiene que ser un entero');
    }
    if (source.level < CHAMPION_LEVEL_MIN || source.level > CHAMPION_LEVEL_MAX) {
      throw new HttpError(400, `level tiene que estar entre ${CHAMPION_LEVEL_MIN} y ${CHAMPION_LEVEL_MAX}`);
    }
    patch.level = source.level;
    touched = true;
  }

  if ('image' in source) {
    if (typeof source.image !== 'string' || !source.image.trim()) {
      throw new HttpError(400, 'image tiene que ser una URL');
    }
    const url = source.image.trim();
    if (url.length > CHAMPION_BACKGROUND_LIMIT) {
      throw new HttpError(400, `image puede tener como maximo ${CHAMPION_BACKGROUND_LIMIT} caracteres`);
    }
    patch.image = url;
    touched = true;
  }

  if ('background' in source) {
    if (source.background === null || source.background === '') {
      patch.background = null;
      touched = true;
    } else if (typeof source.background === 'string') {
      const url = source.background.trim();
      if (url.length > CHAMPION_BACKGROUND_LIMIT) {
        throw new HttpError(400, `background puede tener como máximo ${CHAMPION_BACKGROUND_LIMIT} caracteres`);
      }
      patch.background = url || null;
      touched = true;
    } else {
      throw new HttpError(400, 'background tiene que ser una URL o vacío');
    }
  }

  if ('equipamiento' in source) {
    if (!Array.isArray(source.equipamiento)) {
      throw new HttpError(400, 'equipamiento tiene que ser una lista');
    }
    if (source.equipamiento.length > CHAMPION_EQUIP_SLOTS) {
      throw new HttpError(400, `equipamiento admite como máximo ${CHAMPION_EQUIP_SLOTS} ítems`);
    }
    const items: string[] = [];
    for (const entry of source.equipamiento) {
      if (typeof entry !== 'string' || !entry.trim()) {
        throw new HttpError(400, 'cada ítem del equipamiento tiene que ser un nombre');
      }
      items.push(entry.trim());
    }
    patch.equipamiento = items;
    touched = true;
  }


  if ('roleId' in source) {
    const roleId = typeof source.roleId === 'string' ? source.roleId.trim() : '';
    if (!ROLE_ID.test(roleId)) throw new HttpError(400, 'roleId tiene que ser un id de rol (p. ej. luchador-ad)');
    patch.roleId = roleId;
    touched = true;
  }

  if ('role' in source) {
    const role = typeof source.role === 'string' ? source.role.trim() : '';
    if (!role || role.length > 40) throw new HttpError(400, 'role tiene que ser un texto de 1 a 40 caracteres');
    patch.role = role;
    touched = true;
  }

  if ('active' in source) {
    if (typeof source.active !== 'boolean') {
      throw new HttpError(400, 'active tiene que ser verdadero o falso');
    }
    patch.active = source.active;
    touched = true;
  }
  if ('resource' in source) {
    if (source.resource === null || source.resource === '') patch.resource = null;
    else if (isResourceId(source.resource)) patch.resource = source.resource;
    else throw new HttpError(400, 'resource tiene que ser mana, energia, vida, furia, calor, ferocidad, coraje, sangre, escudo, concentracion, ninguno, otro o null');
    touched = true;
  }
  if ('build' in source) {
    patch.build = stringList(source.build, 'build');
    touched = true;
  }
  if (!touched) throw new HttpError(400, 'El parche del campeón no tiene campos reconocidos');
  return patch;
}

/** Cuándo salta la pasiva de un ítem en combate. */
export const PASSIVE_TRIGGERS = ['on-hit', 'on-ability', 'on-use'] as const;
export type PassiveTrigger = (typeof PASSIVE_TRIGGERS)[number];

/** Bonus temporal que da la pasiva (p. ej. +0,3 letalidad por stack). */
export type ItemPassiveBonus = {
  trigger: PassiveTrigger;
  stat: SheetStatKey;
  amount: number;
  maxStacks?: number;
  durationTurns?: number;
};

/** Daño de la pasiva: % de la vida actual del objetivo. */
export type ItemPassiveDamage = {
  trigger: PassiveTrigger;
  currentHpPct: number;
};

function passiveTrigger(value: unknown, field: string): PassiveTrigger {
  if (typeof value === 'string' && (PASSIVE_TRIGGERS as readonly string[]).includes(value)) return value as PassiveTrigger;
  throw new HttpError(400, `${field} tiene que ser ${PASSIVE_TRIGGERS.join(', ')}`);
}

export function bonusStat(value: unknown, field: string): SheetStatKey {
  if (typeof value === 'string' && (SHEET_STAT_KEYS as readonly string[]).includes(value)) return value as SheetStatKey;
  throw new HttpError(400, `${field} no es una stat válida`);
}

/**
 * Bonus de combate: una stat de la ficha, o un marcador de los efectos con nombre
 * («armed» = siguiente AA potenciado, «cooldown» = efecto en enfriamiento, «charges» = cargas de combate,
 * «stacks» = cargas de habilidad por impacto, «buff» = buff de habilidad activo); los marcadores no suman stats.
 */
export const COMBAT_MARKER_STATS = ['armed', 'cooldown', 'charges', 'stacks', 'buff'] as const;
function combatBonusStat(value: unknown, field: string): SheetStatKey | (typeof COMBAT_MARKER_STATS)[number] {
  if (typeof value === 'string' && (COMBAT_MARKER_STATS as readonly string[]).includes(value)) return value as (typeof COMBAT_MARKER_STATS)[number];
  return bonusStat(value, field);
}

function bonusAmount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0 || Math.abs(value) > 9999) {
    throw new HttpError(400, `${field} tiene que ser un número distinto de 0 (máx. 9999)`);
  }
  return value;
}

function optionalCount(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} tiene que ser un entero entre ${min} y ${max}`);
  }
  return value;
}

function itemPassiveBonus(value: unknown): ItemPassiveBonus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'passiveBonus tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  const bonus: ItemPassiveBonus = {
    trigger: passiveTrigger(source.trigger, 'passiveBonus.trigger'),
    stat: bonusStat(source.stat, 'passiveBonus.stat'),
    amount: bonusAmount(source.amount, 'passiveBonus.amount'),
  };
  const maxStacks = optionalCount(source.maxStacks, 'passiveBonus.maxStacks', 1, 99);
  if (maxStacks !== undefined) bonus.maxStacks = maxStacks;
  const durationTurns = optionalCount(source.durationTurns, 'passiveBonus.durationTurns', 1, 99);
  if (durationTurns !== undefined) bonus.durationTurns = durationTurns;
  return bonus;
}

function itemPassiveDamage(value: unknown): ItemPassiveDamage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'passiveDamage tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  const pct = source.currentHpPct;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new HttpError(400, 'passiveDamage.currentHpPct tiene que ser un número entre 0 y 100');
  }
  return { trigger: passiveTrigger(source.trigger, 'passiveDamage.trigger'), currentHpPct: pct };
}

/** Id de efecto (`spellblade`) o de variante (`spellblade:magic`). */
const NAMED_EFFECT_ID = /^[a-z0-9-]{1,60}(:[a-z0-9-]{1,30})?$/;
const ITEM_MAX_NAMED_EFFECTS = 10;

function itemNamedEffects(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'namedEffects tiene que ser una lista');
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !NAMED_EFFECT_ID.test(entry)) throw new HttpError(400, `Efecto con nombre no válido: ${String(entry)}`);
    if (!ids.includes(entry)) ids.push(entry);
  }
  if (ids.length > ITEM_MAX_NAMED_EFFECTS) throw new HttpError(400, `Máximo ${ITEM_MAX_NAMED_EFFECTS} efectos con nombre por ítem`);
  return ids;
}

export type ItemUpdate = {
  rareza: string;
  efecto: { pasiva: string; activa: string };
  stats: Record<string, number | string>;
  /** undefined deja el coste como está; null lo quita. */
  coste?: number | null;
  /** Ítem con acumulaciones (stacks) en la ficha. */
  hasStacks?: boolean;
  /** Máximo opcional de stacks; null/omitido = sin tope. */
  maxStacks?: number | null;
  /** Cooldown en turnos (null lo quita). */
  cooldown?: number | null;
  /** Duración del efecto en turnos (null lo quita). */
  effectDuration?: number | null;
  /** Destino del efecto (null / self lo quita). */
  effectTarget?: 'self' | 'enemy' | null;
  /** Nombre del estado en combate (null lo quita). */
  effectName?: string | null;
  /** Bonus de stats de la pasiva en combate (null lo quita). */
  passiveBonus?: ItemPassiveBonus | null;
  /** Daño de la pasiva (% vida actual del objetivo; null lo quita). */
  passiveDamage?: ItemPassiveDamage | null;
  /** Efectos con nombre (Vigor, Salvavidas…; ids de namedEffects.ts). [] / null los quita. */
  namedEffects?: string[] | null;
};

const ITEM_TEXT_LIMIT = 2000;
const STAT_TEXT_LIMIT = 20;

function effectText(value: unknown, field: string): string {
  if (value === undefined || value === null) return '-';
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser un texto`);
  const text = value.trim();
  if (text.length > ITEM_TEXT_LIMIT) throw new HttpError(400, `${field} es demasiado largo`);
  return text || '-';
}

function itemStats(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'stats tiene que ser un objeto');
  }
  const stats: Record<string, number | string> = {};
  for (const [rawKey, stat] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    // Mongo no admite "." ni "$" en las claves que se usan con $set.
    if (!key || key.includes('.') || key.startsWith('$')) throw new HttpError(400, `Stat no válida: ${rawKey}`);
    if (typeof stat === 'number') {
      if (!Number.isFinite(stat)) throw new HttpError(400, `${key} tiene que ser un número`);
      stats[key] = stat;
      continue;
    }
    if (typeof stat === 'string' && stat.trim() && stat.trim().length <= STAT_TEXT_LIMIT) {
      stats[key] = stat.trim();
      continue;
    }
    throw new HttpError(400, `${key} tiene que ser un número o un dado (por ejemplo 1d4)`);
  }
  return stats;
}

/** Definición de un ítem para PUT /api/items. El nombre va en la query y no se puede cambiar. */
export function parseItemUpdate(body: unknown): ItemUpdate {
  const source = asObject(body);
  if ('cantidad' in source) {
    throw new HttpError(400, 'La cantidad no se edita aquí: usa tiradas, crafteos o la tienda');
  }
  const rareza = optionalText(source.rareza, 'rareza');
  if (!rareza) throw new HttpError(400, 'El ítem necesita una rareza');

  if (!source.efecto || typeof source.efecto !== 'object' || Array.isArray(source.efecto)) {
    throw new HttpError(400, 'efecto tiene que ser un objeto con pasiva y activa');
  }
  const efecto = source.efecto as Record<string, unknown>;

  const update: ItemUpdate = {
    rareza,
    efecto: {
      pasiva: effectText(efecto.pasiva, 'efecto.pasiva'),
      activa: effectText(efecto.activa, 'efecto.activa'),
    },
    stats: itemStats(source.stats),
  };

  if (source.coste === null) {
    update.coste = null;
  } else if (source.coste !== undefined) {
    if (typeof source.coste !== 'number' || !Number.isFinite(source.coste) || source.coste < 0) {
      throw new HttpError(400, 'coste tiene que ser un número igual o mayor que 0');
    }
    update.coste = source.coste;
  }
  if ('hasStacks' in source) {
    if (typeof source.hasStacks !== 'boolean') throw new HttpError(400, 'hasStacks tiene que ser true o false');
    update.hasStacks = source.hasStacks;
  }
  if ('maxStacks' in source) {
    if (source.maxStacks === null) update.maxStacks = null;
    else {
      if (typeof source.maxStacks !== 'number' || !Number.isInteger(source.maxStacks) || source.maxStacks < 1 || source.maxStacks > 999) {
        throw new HttpError(400, 'maxStacks tiene que ser un entero entre 1 y 999, o null');
      }
      update.maxStacks = source.maxStacks;
    }
  }
  if ('cooldown' in source) {
    if (source.cooldown === null) update.cooldown = null;
    else {
      if (typeof source.cooldown !== 'number' || !Number.isInteger(source.cooldown) || source.cooldown < 1 || source.cooldown > 999) {
        throw new HttpError(400, 'cooldown tiene que ser un entero entre 1 y 999, o null');
      }
      update.cooldown = source.cooldown;
    }
  }
  if ('effectDuration' in source) {
    if (source.effectDuration === null) update.effectDuration = null;
    else {
      if (typeof source.effectDuration !== 'number' || !Number.isInteger(source.effectDuration) || source.effectDuration < 1 || source.effectDuration > 999) {
        throw new HttpError(400, 'effectDuration tiene que ser un entero entre 1 y 999, o null');
      }
      update.effectDuration = source.effectDuration;
    }
  }
  if ('effectTarget' in source) {
    if (source.effectTarget === null || source.effectTarget === 'self') update.effectTarget = null;
    else if (source.effectTarget === 'enemy') update.effectTarget = 'enemy';
    else throw new HttpError(400, 'effectTarget tiene que ser self, enemy o null');
  }
  if ('effectName' in source) {
    if (source.effectName === null) update.effectName = null;
    else {
      const effectName = boundedText(source.effectName, 'effectName', 80);
      update.effectName = effectName || null;
    }
  }
  if ('passiveBonus' in source) update.passiveBonus = source.passiveBonus === null ? null : itemPassiveBonus(source.passiveBonus);
  if ('passiveDamage' in source) update.passiveDamage = source.passiveDamage === null ? null : itemPassiveDamage(source.passiveDamage);
  if ('namedEffects' in source) update.namedEffects = source.namedEffects === null ? null : itemNamedEffects(source.namedEffects);
  return update;
}

const SHOP_MODES = ['compra', 'venta'] as const;

export type ShopMode = (typeof SHOP_MODES)[number];

export type ShopLine = {
  nombre: string;
  cantidad: number;
};

export type ShopOrder = {
  mode: ShopMode;
  lines: ShopLine[];
};

export function parseShopOrder(body: unknown): ShopOrder {
  const source = asObject(body);
  if (typeof source.mode !== 'string' || !SHOP_MODES.includes(source.mode as ShopMode)) {
    throw new HttpError(400, 'La tienda tiene que ser una compra o una venta');
  }
  if (!Array.isArray(source.lines) || source.lines.length === 0) throw new HttpError(400, 'El carrito está vacío');
  if (source.lines.length > 40) throw new HttpError(400, 'El carrito admite como máximo 40 objetos');

  const seen = new Set<string>();
  const lines: ShopLine[] = [];
  for (const entry of source.lines) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpError(400, 'Cada línea del carrito tiene que ser un objeto');
    }
    const line = entry as Record<string, unknown>;
    if (typeof line.nombre !== 'string' || !line.nombre.trim()) throw new HttpError(400, 'Falta el nombre de un objeto del carrito');
    if (typeof line.cantidad !== 'number' || !Number.isInteger(line.cantidad) || line.cantidad < 1 || line.cantidad > 99) {
      throw new HttpError(400, 'La cantidad del carrito tiene que ser un entero entre 1 y 99');
    }
    const nombre = line.nombre.trim();
    const key = nombre.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, 'El carrito repite un objeto');
    seen.add(key);
    lines.push({ nombre, cantidad: line.cantidad });
  }
  return { mode: source.mode as ShopMode, lines };
}

export function parseHistoryRevert(body: unknown): { id: string; kind: HistoryKind } {
  const source = asObject(body);
  if (typeof source.id !== 'string' || !source.id.trim()) throw new HttpError(400, 'Falta el historial');
  if (typeof source.kind !== 'string' || !HISTORY_KINDS.includes(source.kind as HistoryKind)) {
    throw new HttpError(400, 'El historial tiene que ser una tirada, un crafteo, una compra o una venta');
  }
  return { id: source.id.trim(), kind: source.kind as HistoryKind };
}

export const TICKET_TEXT_MAX = 1000;
export const TICKET_TITLE_MAX = 120;
export const TICKET_AUTHOR_MAX = 80;

export type TicketInput = {
  title: string;
  text: string;
  author?: string;
};

export function parseTicketCreate(body: unknown): TicketInput {
  const source = asObject(body);
  if (typeof source.title !== 'string' || !source.title.trim()) throw new HttpError(400, 'Pon un título a la sugerencia');
  const title = source.title.trim();
  if (title.length > TICKET_TITLE_MAX) {
    throw new HttpError(400, `El título admite como máximo ${TICKET_TITLE_MAX} caracteres`);
  }
  if (typeof source.text !== 'string' || !source.text.trim()) throw new HttpError(400, 'Escribe la sugerencia');
  const text = source.text.trim();
  if (text.length > TICKET_TEXT_MAX) {
    throw new HttpError(400, `La sugerencia admite como máximo ${TICKET_TEXT_MAX} caracteres`);
  }
  if (source.author !== undefined && source.author !== null && typeof source.author !== 'string') {
    throw new HttpError(400, 'El autor tiene que ser un texto');
  }
  const author = typeof source.author === 'string' ? source.author.trim() : '';
  if (author.length > TICKET_AUTHOR_MAX) {
    throw new HttpError(400, `El autor admite como máximo ${TICKET_AUTHOR_MAX} caracteres`);
  }
  return author ? { title, text, author } : { title, text };
}

export const TICKET_STATUSES = ['pending', 'accepted', 'rejected', 'completed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value);
}

/** PATCH /api/tickets: { id, status: 'pending' | 'accepted' | 'rejected' | 'completed' }. */
export function parseTicketStatusUpdate(body: unknown): { id: string; status: TicketStatus } {
  const source = asObject(body);
  if (typeof source.id !== 'string' || !source.id.trim()) throw new HttpError(400, 'Falta la sugerencia');
  if (!isTicketStatus(source.status)) {
    throw new HttpError(400, 'Estado no válido (pending, accepted, rejected o completed)');
  }
  return { id: source.id.trim(), status: source.status };
}

/** Id de la sugerencia a borrar: ?id= o { id } en el cuerpo. */
export function parseTicketId(queryId: string | undefined, body: unknown): string {
  let id = queryId;
  if (!id && body && typeof body === 'object' && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).id;
    if (typeof value === 'string') id = value;
  }
  if (!id || !id.trim()) throw new HttpError(400, 'Falta la sugerencia');
  return id.trim();
}

export function parsePlayerReplace(body: unknown): PlayerReplace {
  const source = asObject(body);
  return {
    ...(source.basicAttack === undefined ? {} : { basicAttack: basicAttack(source.basicAttack) }),
    abilities: abilities(source.abilities, true) as PlayerReplace['abilities'],
    equipamiento: equipmentList(source.equipamiento),
    build: stringList(source.build, 'build'),
  };
}

/** Fila de una tabla de rol: las mismas columnas que la ficha (hp, ac, mana, ad…). */
export type RoleStatLine = Record<SheetStatKey, number | string>;

export type RoleTable = {
  id: string;
  name: string;
  /** Índice 0 = nivel 1. */
  levels: RoleStatLine[];
};

export type RolePatch = {
  name?: string;
  levels?: RoleStatLine[];
};

const ROLE_NAME_LIMIT = 40;
const ROLE_LEVEL_LIMIT = 30;
const ROLE_TEXT_LIMIT = 40;

export function isRoleId(value: string): boolean {
  return ROLE_ID.test(value);
}

function roleStatLine(value: unknown, index: number): RoleStatLine {
  const field = `levels[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} tiene que ser un objeto`);
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!SHEET_STAT_KEYS.includes(key as SheetStatKey)) throw new HttpError(400, `${field}: stat desconocida ${key}`);
  }
  const line = {} as RoleStatLine;
  for (const key of SHEET_STAT_KEYS) {
    const raw = source[key];
    if (raw === undefined && OPTIONAL_ROLE_STAT_KEYS.includes(key)) {
      line[key] = 0;
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      line[key] = raw;
      continue;
    }
    if (typeof raw === 'string' && raw.trim() && raw.trim().length <= ROLE_TEXT_LIMIT) {
      line[key] = raw.trim();
      continue;
    }
    throw new HttpError(400, `${field}.${key} tiene que ser un número o un dado (por ejemplo 2d4)`);
  }
  return line;
}

export function parseRolePatch(body: unknown): RolePatch {
  const source = asObject(body);
  for (const key of Object.keys(source)) {
    if (key !== 'name' && key !== 'levels') throw new HttpError(400, `Campo de rol desconocido: ${key}`);
  }
  const patch: RolePatch = {};
  if ('name' in source) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name || name.length > ROLE_NAME_LIMIT) {
      throw new HttpError(400, `name tiene que ser un texto de 1 a ${ROLE_NAME_LIMIT} caracteres`);
    }
    patch.name = name;
  }
  if ('levels' in source) {
    const levels = source.levels;
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > ROLE_LEVEL_LIMIT) {
      throw new HttpError(400, `levels tiene que ser una lista de 1 a ${ROLE_LEVEL_LIMIT} niveles`);
    }
    patch.levels = levels.map(roleStatLine);
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

const LOOT_RARITIES = ['basico', 'epico', 'legendario'] as const;
const SPAWN_TYPES = ['Basico', 'Epico'] as const;
const DROP_ITEMS = ['Prob. basico', 'Prob. epico', 'Prob. legendario'] as const;
const DROP_TABLES = ['Drop basico', 'Drop epico', 'Drop legendario'] as const;

export type LootRuleRarity = (typeof LOOT_RARITIES)[number];
export type DropTableKey = (typeof DROP_TABLES)[number];
export type SpawnRoll = { type: (typeof SPAWN_TYPES)[number]; prob: number };
export type DropChance = { item: (typeof DROP_ITEMS)[number]; prob: number };

/**
 * Reglas fijas del botín guardadas en loot/tables.
 * wildCard: parte fija de "Lo que quieras" en cada tabla (0 a 1); el resto se reparte entre los ítems.
 */
export type LootRules = {
  rolls: SpawnRoll[];
  wildCard: Record<LootRuleRarity, number>;
} & Record<DropTableKey, DropChance[]>;

export type LootRulesPatch = Partial<LootRules>;

export const LOOT_RULE_KEYS = ['rolls', ...DROP_TABLES, 'wildCard'] as const;

function percent(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new HttpError(400, `${field} tiene que ser un número entre 0 y 100`);
  }
  return value;
}

function spawnRolls(value: unknown): SpawnRoll[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, 'rolls tiene que ser una lista');
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const type = entry?.type;
    if (typeof type !== 'string' || !SPAWN_TYPES.includes(type as SpawnRoll['type'])) {
      throw new HttpError(400, `rolls[${index}].type tiene que ser ${SPAWN_TYPES.join(' o ')}`);
    }
    if (seen.has(type)) throw new HttpError(400, `rolls repite el tipo ${type}`);
    seen.add(type);
    return { type: type as SpawnRoll['type'], prob: percent(entry?.prob, `rolls[${index}].prob`) };
  });
}

function dropTable(value: unknown, field: DropTableKey): DropChance[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, `${field} tiene que ser una lista`);
  const seen = new Set<string>();
  const entries = value.map((raw, index) => {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const item = entry?.item;
    if (typeof item !== 'string' || !DROP_ITEMS.includes(item as DropChance['item'])) {
      throw new HttpError(400, `${field}[${index}].item tiene que ser ${DROP_ITEMS.join(', ')}`);
    }
    if (seen.has(item)) throw new HttpError(400, `${field} repite ${item}`);
    seen.add(item);
    return { item: item as DropChance['item'], prob: percent(entry?.prob, `${field}[${index}].prob`) };
  });
  const total = entries.reduce((sum, entry) => sum + entry.prob, 0);
  if (Math.abs(total - 100) > 1e-6) throw new HttpError(400, `${field} tiene que sumar 100 (suma ${total})`);
  return entries;
}

function wildCard(value: unknown, partial: boolean): Partial<Record<LootRuleRarity, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'wildCard tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!LOOT_RARITIES.includes(key as LootRuleRarity)) throw new HttpError(400, `wildCard: rareza desconocida ${key}`);
  }
  const result: Partial<Record<LootRuleRarity, number>> = {};
  for (const rarity of LOOT_RARITIES) {
    const raw = source[rarity];
    if (raw === undefined && partial) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw >= 1) {
      throw new HttpError(400, `wildCard.${rarity} tiene que ser un número entre 0 y 1 (sin llegar a 1)`);
    }
    result[rarity] = raw;
  }
  return result;
}

/** Cambia solo las reglas del botín; los ítems se calculan siempre del catálogo. */
export function parseLootRulesPatch(body: unknown): LootRulesPatch {
  const source = asObject(body);
  for (const key of Object.keys(source)) {
    if (!LOOT_RULE_KEYS.includes(key as (typeof LOOT_RULE_KEYS)[number])) {
      throw new HttpError(400, `Campo de botín desconocido: ${key}`);
    }
  }
  const patch: LootRulesPatch = {};
  if ('rolls' in source) patch.rolls = spawnRolls(source.rolls);
  for (const table of DROP_TABLES) {
    if (table in source) patch[table] = dropTable(source[table], table);
  }
  if ('wildCard' in source) patch.wildCard = wildCard(source.wildCard, true) as LootRules['wildCard'];
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

/** Lee las reglas completas guardadas en Mongo. Lanza si falta algo. */
export function parseLootRules(value: unknown): LootRules {
  const source = asObject(value);
  const rules = {
    rolls: spawnRolls(source.rolls),
    wildCard: wildCard(source.wildCard, false) as LootRules['wildCard'],
  } as LootRules;
  for (const table of DROP_TABLES) rules[table] = dropTable(source[table], table);
  return rules;
}

export const HISTORY_BATCH_MAX = 200;

export function parseHistoryRevertBatch(body: unknown): { id: string; kind: HistoryKind }[] {
  const source = asObject(body);
  if (!Array.isArray(source.entries) || source.entries.length === 0) {
    throw new HttpError(400, 'No hay entradas seleccionadas');
  }
  if (source.entries.length > HISTORY_BATCH_MAX) {
    throw new HttpError(400, `Como mucho ${HISTORY_BATCH_MAX} entradas a la vez`);
  }
  const seen = new Set<string>();
  const out: { id: string; kind: HistoryKind }[] = [];
  for (const raw of source.entries) {
    const entry = parseHistoryRevert(raw);
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export const AUGMENT_NAME_MAX = 80;
export const AUGMENT_DESCRIPTION_MAX = 1000;

/** Aumento del catálogo (colección augments). Sin precio propio: salen en la ruleta según su rareza. */
export const AUGMENT_RARITIES = ['plata', 'oro', 'prismatico'] as const;
export type AugmentRarity = typeof AUGMENT_RARITIES[number];

export type AugmentInput = {
  rarity: AugmentRarity;
  name: string;
  description: string;
  /** Efectos de nivel 1, 2 y 3 del aumento (aparte del nivel del player). null = aumento sin niveles. */
  levels: string[] | null;
};

/** POST /api/augments: { name, rarity?, description?, levels? (3 efectos o null) }. price ya no se usa (se ignora). Con partial (PATCH) todos opcionales. */
export function parseAugmentInput(body: unknown, partial: true): Partial<AugmentInput>;
export function parseAugmentInput(body: unknown, partial?: false): AugmentInput;
export function parseAugmentInput(body: unknown, partial = false): Partial<AugmentInput> {
  const source = asObject(body);
  const out: Partial<AugmentInput> = {};
  if (source.name !== undefined || !partial) {
    if (typeof source.name !== 'string' || !source.name.trim()) throw new HttpError(400, 'Pon un nombre al aumento');
    const name = source.name.trim();
    if (name.length > AUGMENT_NAME_MAX) throw new HttpError(400, `El nombre admite como máximo ${AUGMENT_NAME_MAX} caracteres`);
    out.name = name;
  }
  if (source.description !== undefined && source.description !== null) {
    if (typeof source.description !== 'string') throw new HttpError(400, 'La descripción tiene que ser un texto');
    const description = source.description.trim();
    if (description.length > AUGMENT_DESCRIPTION_MAX) {
      throw new HttpError(400, `La descripción admite como máximo ${AUGMENT_DESCRIPTION_MAX} caracteres`);
    }
    out.description = description;
  } else if (!partial) {
    out.description = '';
  }
  if (source.rarity !== undefined && source.rarity !== null) {
    if (typeof source.rarity !== 'string' || !(AUGMENT_RARITIES as readonly string[]).includes(source.rarity)) {
      throw new HttpError(400, 'La rareza tiene que ser plata, oro o prismatico');
    }
    out.rarity = source.rarity as AugmentRarity;
  } else if (!partial) {
    out.rarity = 'plata';
  }
  if (source.levels !== undefined) out.levels = parseAugmentLevels(source.levels, 'levels');
  else if (!partial) out.levels = null;
  if (partial && Object.keys(out).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return out;
}

/** Puntos de interés propios del mapa. «party» = ubicación de la party (solo puede haber una). */
export const MAP_POI_KINDS = ['party', 'poi'] as const;
export type MapPoiKind = (typeof MAP_POI_KINDS)[number];
/** Lado del mapa cosido en px (x/y van de 0 a este valor, origen arriba-izquierda). */
export const MAP_POI_SIZE = 8192;
export const MAP_POI_NAME_MAX = 60;
export const MAP_POI_NOTE_MAX = 500;

export type MapPoiInput = { kind: MapPoiKind; name: string; note?: string; x: number; y: number };
export type MapPoiPatch = { name?: string; note?: string | null; x?: number; y?: number };

function mapCoord(value: unknown, field: 'x' | 'y'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAP_POI_SIZE) {
    throw new HttpError(400, `${field} tiene que ser un número entre 0 y ${MAP_POI_SIZE}`);
  }
  return Math.round(value * 10) / 10;
}

function mapPoiName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'name tiene que ser un texto');
  const name = value.trim();
  if (!name) throw new HttpError(400, 'Falta el nombre del punto');
  if (name.length > MAP_POI_NAME_MAX) throw new HttpError(400, `name puede tener como máximo ${MAP_POI_NAME_MAX} caracteres`);
  return name;
}

function mapPoiNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'note tiene que ser un texto');
  const note = value.trim();
  if (note.length > MAP_POI_NOTE_MAX) throw new HttpError(400, `note puede tener como máximo ${MAP_POI_NOTE_MAX} caracteres`);
  return note || null;
}

function mapPoiKeys(source: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new HttpError(400, `Campo desconocido: ${key}`);
  }
}

export function parseMapPoiInput(body: unknown): MapPoiInput {
  const source = asObject(body);
  mapPoiKeys(source, ['kind', 'name', 'note', 'x', 'y']);
  const kind = source.kind;
  if (typeof kind !== 'string' || !MAP_POI_KINDS.includes(kind as MapPoiKind)) {
    throw new HttpError(400, 'kind tiene que ser party o poi');
  }
  const input: MapPoiInput = {
    kind: kind as MapPoiKind,
    // La party puede ir sin nombre: se llama «Party».
    name: kind === 'party' && (source.name === undefined || source.name === '') ? 'Party' : mapPoiName(source.name),
    x: mapCoord(source.x, 'x'),
    y: mapCoord(source.y, 'y'),
  };
  if (source.note !== undefined) {
    const note = mapPoiNote(source.note);
    if (note) input.note = note;
  }
  return input;
}

export function parseMapPoiPatch(body: unknown): MapPoiPatch {
  const source = asObject(body);
  if ('kind' in source) throw new HttpError(400, 'El tipo de un punto no se puede cambiar');
  mapPoiKeys(source, ['id', 'name', 'note', 'x', 'y']);
  const patch: MapPoiPatch = {};
  if (source.name !== undefined) patch.name = mapPoiName(source.name);
  if (source.note !== undefined) patch.note = mapPoiNote(source.note);
  if (source.x !== undefined) patch.x = mapCoord(source.x, 'x');
  if (source.y !== undefined) patch.y = mapCoord(source.y, 'y');
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

/** Mecánicas (FAQ): leer cualquiera; crear/editar/borrar solo admin. */
export const FAQ_TITLE_MAX = 120;
export const FAQ_BODY_MAX = 4000;
export const FAQ_CATEGORY_MAX = 40;
export const FAQ_ORDER_MAX = 1_000_000;

export type FaqInput = { title: string; body: string; category?: string; order?: number };
export type FaqPatch = { title?: string; body?: string; category?: string | null; order?: number };

function faqText(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser un texto`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (required && !text) throw new HttpError(400, field === 'title' ? 'Falta el título' : 'Falta el texto');
  if (text.length > max) throw new HttpError(400, `${field} puede tener como máximo ${max} caracteres`);
  return text;
}

function faqCategory(value: unknown): string | null {
  if (value === null) return null;
  const text = faqText(value, 'category', FAQ_CATEGORY_MAX, false);
  if (/[\n\t]/.test(text)) throw new HttpError(400, 'category tiene que ser una sola línea');
  return text || null;
}

function faqOrder(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > FAQ_ORDER_MAX) {
    throw new HttpError(400, `order tiene que ser un entero entre 0 y ${FAQ_ORDER_MAX}`);
  }
  return value;
}

function faqKeys(source: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new HttpError(400, `Campo desconocido: ${key}`);
  }
}

export function parseFaqInput(body: unknown): FaqInput {
  const source = asObject(body);
  faqKeys(source, ['title', 'body', 'category', 'order']);
  const title = faqText(source.title, 'title', FAQ_TITLE_MAX, true);
  if (/\n/.test(title)) throw new HttpError(400, 'El título tiene que ser una sola línea');
  const input: FaqInput = { title, body: faqText(source.body, 'body', FAQ_BODY_MAX, true) };
  if (source.category !== undefined) {
    const category = faqCategory(source.category);
    if (category) input.category = category;
  }
  if (source.order !== undefined) input.order = faqOrder(source.order);
  return input;
}

export function parseFaqPatch(body: unknown): FaqPatch {
  const source = asObject(body);
  faqKeys(source, ['id', 'title', 'body', 'category', 'order']);
  const patch: FaqPatch = {};
  if (source.title !== undefined) {
    const title = faqText(source.title, 'title', FAQ_TITLE_MAX, true);
    if (/\n/.test(title)) throw new HttpError(400, 'El título tiene que ser una sola línea');
    patch.title = title;
  }
  if (source.body !== undefined) patch.body = faqText(source.body, 'body', FAQ_BODY_MAX, true);
  if (source.category !== undefined) patch.category = faqCategory(source.category);
  if (source.order !== undefined) patch.order = faqOrder(source.order);
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

// ── NPCs / Monstruos ──

export const NPC_KINDS = ['npc', 'monstruo'] as const;
export type NpcKind = (typeof NPC_KINDS)[number];
export const NPC_STAT_KEYS = ['hp', 'mana', 'ac', 'mr', 'spe', 'ad', 'ap', 'atkSpe', 'abSpe'] as const;
export type NpcStatKey = (typeof NPC_STAT_KEYS)[number];
export const NPC_DICE_STAT_KEYS: readonly NpcStatKey[] = ['ad', 'ap'];
export type NpcStats = Partial<Record<NpcStatKey, number | string>>;

export const NPC_NAME_MAX = 80;
export const NPC_TAG_MAX = 40;
export const NPC_DESCRIPTION_MAX = 4000;
export const NPC_URL_MAX = 2000;
export const NPC_LEVEL_MIN = 0;
export const NPC_LEVEL_MAX = 30;
export const NPC_ABILITIES_MAX = 30;
const NPC_ABILITY_LABEL_MAX = 20;
const NPC_ABILITY_TEXT_MAX = 2000;
const NPC_ABILITY_COST_MAX = 200;
const NPC_ABILITY_ID = /^[a-z0-9-]{1,40}$/i;

/** Habilidad libre de un NPC: como las de campeón pero sin slot fijo (P/Q/W/E/R). */
export type NpcAbility = {
  id: string;
  name: string;
  /** Etiqueta corta opcional (Pasiva, Ataque, Q, Fase 2…). */
  label?: string;
  description?: string;
  cost?: string;
  damage?: ChampionAbilityDamage;
  effect?: ChampionAbilityEffect[];
  mechanics?: ChampionAbilityMechanics;
};

/** Encuadre de la foto: punto focal (0-100 %) y zoom (1 = sin zoom). */
export type NpcImageFrame = { x: number; y: number; zoom: number };
export const NPC_ZOOM_MIN = 1;
export const NPC_ZOOM_MAX = 4;

function frameNumber(raw: unknown, field: string, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    throw new HttpError(400, `imageFrame.${field} tiene que ser un número entre ${min} y ${max}`);
  }
  return Math.round(raw * 100) / 100;
}

/** null / centrado sin zoom = sin encuadre propio. */
function parseNpcImageFrame(value: unknown): NpcImageFrame | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'imageFrame tiene que ser un objeto { x, y, zoom }');
  const source = value as Record<string, unknown>;
  const frame: NpcImageFrame = {
    x: frameNumber(source.x, 'x', 0, 100, 50),
    y: frameNumber(source.y, 'y', 0, 100, 50),
    zoom: frameNumber(source.zoom, 'zoom', NPC_ZOOM_MIN, NPC_ZOOM_MAX, 1),
  };
  return frame.x === 50 && frame.y === 50 && frame.zoom === 1 ? null : frame;
}

/** Encuadre propio del círculo (tarjeta). null = vinculado al de la ficha; si es objeto se guarda tal cual (aunque esté centrado). */
function parseNpcCircleFrame(value: unknown): NpcImageFrame | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'imageFrameCircle tiene que ser un objeto { x, y, zoom } o null');
  const source = value as Record<string, unknown>;
  return {
    x: frameNumber(source.x, 'x', 0, 100, 50),
    y: frameNumber(source.y, 'y', 0, 100, 50),
    zoom: frameNumber(source.zoom, 'zoom', NPC_ZOOM_MIN, NPC_ZOOM_MAX, 1),
  };
}

export type NpcInput = {
  name: string;
  kind: NpcKind;
  /** Tipo libre: Bestia, Mercader, No muerto… */
  type: string;
  region: string;
  level: number;
  image: string;
  /** Encuadre de la foto (object-position + zoom). null = centrada. */
  imageFrame: NpcImageFrame | null;
  /** Encuadre de la tarjeta (círculo). null = vinculado: usa imageFrame. */
  imageFrameCircle: NpcImageFrame | null;
  background: string | null;
  description: string;
  /** Notas públicas visibles para toda la party (distintas de las privadas por player). */
  publicNotes: string;
  stats: NpcStats;
  abilities: NpcAbility[];
  /** Visible para los players (como «Activo» en campeones). */
  visible: boolean;
};

function boundedText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser un texto`);
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, `${field} admite como máximo ${max} caracteres`);
  return text;
}

function randomAbilityId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const NPC_DICE_RE = /^(?:[+-]?\d+d\d+|[+-]?\d+)(?:[+-]\d+d\d+|[+-]\d+)*$/i;

function parseNpcStatValue(raw: unknown, key: NpcStatKey): number | string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/\s+/g, '');
    if (!text) throw new HttpError(400, `stats.${key} está vacío`);
    if ((NPC_DICE_STAT_KEYS as readonly string[]).includes(key) && NPC_DICE_RE.test(text)) {
      if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
      return text;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  }
  throw new HttpError(400, (NPC_DICE_STAT_KEYS as readonly string[]).includes(key)
    ? `stats.${key} tiene que ser un número o dados (p. ej. 3d4 o 4d4+2)`
    : `stats.${key} tiene que ser un número`);
}

function parseNpcStats(value: unknown): NpcStats {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'stats tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  const stats: NpcStats = {};
  for (const key of NPC_STAT_KEYS) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') continue;
    stats[key] = parseNpcStatValue(raw, key);
  }
  return stats;
}

function parseNpcAbilities(value: unknown): NpcAbility[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'abilities tiene que ser una lista');
  if (value.length > NPC_ABILITIES_MAX) throw new HttpError(400, `Como máximo ${NPC_ABILITIES_MAX} habilidades por NPC`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, `abilities[${index}] tiene que ser un objeto`);
    }
    const source = item as Record<string, unknown>;
    const name = boundedText(source.name, 'El nombre de la habilidad', NPC_NAME_MAX);
    if (!name) throw new HttpError(400, `La habilidad ${index + 1} necesita un nombre`);
    let id = typeof source.id === 'string' && NPC_ABILITY_ID.test(source.id.trim()) ? source.id.trim() : randomAbilityId();
    while (seen.has(id)) id = randomAbilityId();
    seen.add(id);
    const ability: NpcAbility = { id, name };
    const label = boundedText(source.label, 'La etiqueta de la habilidad', NPC_ABILITY_LABEL_MAX);
    const description = boundedText(source.description, 'La descripción de la habilidad', NPC_ABILITY_TEXT_MAX);
    const cost = boundedText(source.cost, 'El coste de la habilidad', NPC_ABILITY_COST_MAX);
    if (label) ability.label = label;
    if (description) ability.description = description;
    if (cost) ability.cost = cost;
    const damage = parseDamage(source.damage ?? undefined);
    if (damage) ability.damage = damage;
    const effect = parseEffects(source.effect ?? undefined);
    if (effect) ability.effect = effect;
    if (source.mechanics !== undefined && source.mechanics !== null) {
      const mechanics = parseAbilityMechanics(source.mechanics);
      if (mechanics) ability.mechanics = mechanics;
    }
    return ability;
  });
}

/**
 * POST /api/npcs: { name, kind?, type?, region?, level?, image?, imageFrame? {x,y,zoom}, imageFrameCircle? {x,y,zoom}|null, background?, description?, stats?, abilities?, visible? }.
 * Con partial (PATCH) todos opcionales; abilities/stats se sustituyen enteros.
 */
export function parseNpcInput(body: unknown, partial: true): Partial<NpcInput>;
export function parseNpcInput(body: unknown, partial?: false): NpcInput;
export function parseNpcInput(body: unknown, partial = false): Partial<NpcInput> {
  const source = asObject(body);
  const out: Partial<NpcInput> = {};
  const has = (key: string) => source[key] !== undefined;

  if (has('name') || !partial) {
    const name = boundedText(source.name, 'El nombre', NPC_NAME_MAX);
    if (!name) throw new HttpError(400, 'Pon un nombre al NPC');
    out.name = name;
  }
  if (has('kind') && source.kind !== null) {
    if (typeof source.kind !== 'string' || !(NPC_KINDS as readonly string[]).includes(source.kind)) {
      throw new HttpError(400, 'kind tiene que ser npc o monstruo');
    }
    out.kind = source.kind as NpcKind;
  } else if (!partial) out.kind = 'npc';
  if (has('type') || !partial) out.type = boundedText(source.type, 'El tipo', NPC_TAG_MAX);
  if (has('region') || !partial) out.region = boundedText(source.region, 'La región', NPC_TAG_MAX);
  if (has('level') && source.level !== null) {
    if (typeof source.level !== 'number' || !Number.isInteger(source.level) || source.level < NPC_LEVEL_MIN || source.level > NPC_LEVEL_MAX) {
      throw new HttpError(400, `El nivel tiene que ser un entero entre ${NPC_LEVEL_MIN} y ${NPC_LEVEL_MAX}`);
    }
    out.level = source.level;
  } else if (!partial) out.level = 1;
  if (has('image') || !partial) out.image = boundedText(source.image, 'La URL de la foto', NPC_URL_MAX);
  if (has('imageFrame') || !partial) out.imageFrame = parseNpcImageFrame(source.imageFrame);
  if (has('imageFrameCircle') || !partial) out.imageFrameCircle = parseNpcCircleFrame(source.imageFrameCircle);
  if (has('background') || source.background === null || !partial) {
    out.background = boundedText(source.background, 'La URL del fondo', NPC_URL_MAX) || null;
  }
  if (has('description') || !partial) out.description = boundedText(source.description, 'La descripción', NPC_DESCRIPTION_MAX);
  if (has('publicNotes') || !partial) out.publicNotes = boundedText(source.publicNotes, 'Las notas públicas', NPC_DESCRIPTION_MAX);
  if (has('stats') || !partial) out.stats = parseNpcStats(source.stats);
  if (has('abilities') || !partial) out.abilities = parseNpcAbilities(source.abilities);
  if (has('visible') && source.visible !== null) {
    if (typeof source.visible !== 'boolean') throw new HttpError(400, 'visible tiene que ser verdadero o falso');
    out.visible = source.visible;
  } else if (!partial) out.visible = false;

  if (partial && Object.keys(out).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return out;
}

// ── Relaciones entre campeones y NPCs (colección relations) ──

export const RELATION_KINDS = ['champion', 'npc'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];
export type RelationRef = { kind: RelationKind; id: string };
export const RELATION_NOTE_MAX = 200;
const RELATION_ID_MAX = 120;

export type RelationInput = { a: RelationRef; b: RelationRef; note: string; visibleToPlayers?: boolean };
/** PATCH /api/relations: nota y/o si la ven los players. */
export type RelationPatch = { note?: string; visibleToPlayers?: boolean };

function parseRelationVisible(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, 'visibleToPlayers tiene que ser true o false');
  return value;
}

export function parseRelationRef(value: unknown, field: string): RelationRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser { kind, id }`);
  const source = value as Record<string, unknown>;
  if (typeof source.kind !== 'string' || !(RELATION_KINDS as readonly string[]).includes(source.kind)) {
    throw new HttpError(400, `${field}.kind tiene que ser champion o npc`);
  }
  if (typeof source.id !== 'string' || !source.id.trim()) throw new HttpError(400, `Falta ${field}.id`);
  const id = source.id.trim();
  if (id.length > RELATION_ID_MAX) throw new HttpError(400, `${field}.id es demasiado largo`);
  return { kind: source.kind as RelationKind, id };
}

export function parseRelationNote(value: unknown): string {
  return boundedText(value, 'La nota de la relación', RELATION_NOTE_MAX);
}

/** POST /api/relations: { a: { kind, id }, b: { kind, id }, note?, visibleToPlayers? }. */
export function parseRelationInput(body: unknown): RelationInput {
  const source = asObject(body);
  const input: RelationInput = { a: parseRelationRef(source.a, 'a'), b: parseRelationRef(source.b, 'b'), note: parseRelationNote(source.note) };
  if (source.visibleToPlayers !== undefined) input.visibleToPlayers = parseRelationVisible(source.visibleToPlayers);
  return input;
}

/** PATCH /api/relations?id=: { note?, visibleToPlayers? } (al menos uno). */
export function parseRelationPatch(body: unknown): RelationPatch {
  const source = asObject(body);
  const patch: RelationPatch = {};
  if (source.note !== undefined) patch.note = parseRelationNote(source.note);
  if (source.visibleToPlayers !== undefined) patch.visibleToPlayers = parseRelationVisible(source.visibleToPlayers);
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar (note, visibleToPlayers)');
  return patch;
}

// ── Combate (tracker de iniciativa) ──

export const COMBAT_EFFECT_PRESETS = [
  'Aturdido',
  'Envenenado',
  'Ralentizado',
  'Quemado',
  'Silenciado',
  'Enraizado',
  'Cegado',
  'Invisible',
  'Escudo',
  'Sangrado',
  'Heridas graves',
  'MR reducido',
  'AC reducido',
] as const;

const COMBAT_PARTICIPANT_KINDS = ['player', 'npc', 'champion', 'custom'] as const;
export type CombatParticipantKind = (typeof COMBAT_PARTICIPANT_KINDS)[number];

export type CombatEffect = {
  id: string;
  name: string;
  /** Turnos restantes; baja al empezar el turno de este participante. */
  duration: number;
  /** Valor numérico opcional (p. ej. reducción de AC/MR). */
  value?: number;
  /** Acumulaciones del estado. */
  stacks?: number;
  /** Origen: item:<nombre>, ability:<nombre> o un rasgo de combate (capture:, taunt:, entry:, …). */
  source?: string;
};

export type CombatParticipant = {
  id: string;
  kind: CombatParticipantKind;
  name: string;
  baseName?: string;
  copyIndex?: number;
  /** Nombre del player o id del NPC de origen. */
  sourceId?: string;
  initiative: number;
  initiativeBonus?: number;
  /** Opcional / legacy; la UI ya no escribe PG. */
  hp?: number;
  maxHp?: number;
  defeated: boolean;
  image?: string;
  effects: CombatEffect[];
  /** Recurso actual del campeón en este combate. */
  currentResource?: number;
  cooldowns?: Record<string, number>;
  activeEffects?: Record<string, number>;
  /** Fase actual (0 = base) de habilidades con variantes. Claves ability:<nombre>. */
  abilityPhases?: Record<string, number>;
  /** Copia propia de la ficha (campeón / NPC) para este participante. */
  sheet?: CombatSheet;
  /** Vida temporal y escudo (campeones / NPCs; los players los llevan en su ficha). */
  tempHp?: number;
  shield?: number;
  /** Máximo del recurso fijado a mano (si no, el de sus stats / Recurso). */
  resourceMax?: number;
  /** Ataques / habilidades que le quedan este turno (ausente = todos). */
  actionsLeft?: { attacks?: number; abilities?: number; items?: number };
  /** Ataques / habilidades extra de este turno (ya incluidos en actionsLeft). */
  actionsExtra?: { attacks?: number; abilities?: number; items?: number };
  /** Bonus temporales de stats (manuales o de pasivas de ítems). */
  bonuses?: CombatBonus[];
  /** Cargas de Vigor (0-100; solo cuentan con un ítem de Vigor). */
  vigor?: number;
  /** Movimiento gastado este turno (casillas); se borra al empezar su turno. */
  movementUsed?: number;
};

export type CombatState = {
  active: boolean;
  round: number;
  /** Índice en la lista ya ordenada por iniciativa. */
  turnIndex: number;
  participants: CombatParticipant[];
  /** Vigor que da cada casilla de movimiento (ajustable en el combate; por defecto 1). */
  vigorPerMove?: number;
  updatedAt?: string;
};

export const COMBAT_VIGOR_MAX = 100;

const COMBAT_NAME_MAX = 80;
const COMBAT_EFFECT_NAME_MAX = 80;
const COMBAT_MAX_PARTICIPANTS = 40;
const COMBAT_MAX_EFFECTS = 12;

function combatId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} tiene que ser un texto`);
  const text = value.trim();
  if (text.length > 64) throw new HttpError(400, `${field} es demasiado largo`);
  return text;
}

/** Prefijos de rasgo de combate (combatTraits.ts). item:/ability: siguen permitidos. */
const COMBAT_TRAIT_SOURCE_PREFIXES = [
  'capture:',
  'taunt:',
  'entry:',
  'tough:',
  'aamark:',
  'start:',
  'once:enemy-ult:',
  'aura:',
  'survive:',
  'flatdr:',
  'enemy-ult:',
] as const;

/**
 * item:<nombre> y ability:<nombre> no admiten '.' (protección Mongo).
 * Los rasgos sí, porque el id del participante es un UUID (p. ej. entry:<uuid>:<nombre>).
 */
function isAllowedEffectSource(key: string): boolean {
  if (!key || key.includes('$')) return false;
  if (key.startsWith('item:') || key.startsWith('ability:')) {
    const prefix = key.startsWith('item:') ? 'item:' : 'ability:';
    return key.length > prefix.length && !key.includes('.');
  }
  return COMBAT_TRAIT_SOURCE_PREFIXES.some(prefix => key.startsWith(prefix) && key.length > prefix.length);
}

function combatEffect(value: unknown): CombatEffect {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Cada efecto tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const name = boundedText(source.name, 'El nombre del efecto', COMBAT_EFFECT_NAME_MAX);
  if (!name) throw new HttpError(400, 'Cada efecto necesita un nombre');
  const effect: CombatEffect = {
    id: combatId(source.id, 'effect.id'),
    name,
    duration: nonNegInt(source.duration, 'effect.duration'),
  };
  if ('value' in source && source.value !== undefined && source.value !== null) {
    if (typeof source.value !== 'number' || !Number.isInteger(source.value) || source.value < 1 || source.value > 99) {
      throw new HttpError(400, 'effect.value tiene que ser un entero entre 1 y 99');
    }
    effect.value = source.value;
  }
  if ('stacks' in source && source.stacks !== undefined && source.stacks !== null) {
    if (typeof source.stacks !== 'number' || !Number.isInteger(source.stacks) || source.stacks < 1 || source.stacks > 999) {
      throw new HttpError(400, 'effect.stacks tiene que ser un entero entre 1 y 999');
    }
    effect.stacks = source.stacks;
  }
  if ('source' in source && source.source !== undefined && source.source !== null) {
    const key = boundedText(source.source, 'effect.source', 120);
    if (!isAllowedEffectSource(key)) {
      throw new HttpError(400, 'effect.source tiene que ser item:<nombre>, ability:<nombre> o un rasgo de combate (capture:, taunt:, entry:, tough:, start:…)');
    }
    effect.source = key;
  }
  return effect;
}

/** Bonus temporal de stats en combate: amount × stacks se suma al total; turns baja al empezar su turno. */
export type CombatBonus = {
  id: string;
  /** Stat de la ficha o marcador de efecto con nombre (armed / cooldown / charges). */
  stat: SheetStatKey | (typeof COMBAT_MARKER_STATS)[number];
  amount: number;
  stacks?: number;
  maxStacks?: number;
  turns?: number;
  /** Marcador 'charges' (cargas de combate): turnos para la siguiente recarga y cada cuántos recarga. */
  recharge?: number;
  rechargeEvery?: number;
  /** "manual" o "item:<nombre>". */
  source?: string;
  label?: string;
};

const COMBAT_MAX_BONUSES = 30;

export function combatBonuses(value: unknown): CombatBonus[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'bonuses tiene que ser una lista');
  if (value.length > COMBAT_MAX_BONUSES) throw new HttpError(400, `Máximo ${COMBAT_MAX_BONUSES} bonus por participante`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpError(400, `bonuses[${index}] tiene que ser un objeto`);
    const source = entry as Record<string, unknown>;
    const id = boundedText(source.id, `bonuses[${index}].id`, 64);
    if (!id) throw new HttpError(400, `bonuses[${index}].id es obligatorio`);
    const stat = combatBonusStat(source.stat, `bonuses[${index}].stat`);
    // Cargas de combate: amount = cargas que quedan (0 vale), maxStacks = máximo.
    const amount = stat === 'charges' ? nonNegInt(source.amount, `bonuses[${index}].amount`) : bonusAmount(source.amount, `bonuses[${index}].amount`);
    if (stat === 'charges' && amount > 99) throw new HttpError(400, `bonuses[${index}].amount: máx. 99 cargas`);
    const bonus: CombatBonus = { id, stat, amount };
    if (stat === 'charges') {
      const recharge = optionalCount(source.recharge, `bonuses[${index}].recharge`, 1, 99);
      if (recharge !== undefined) bonus.recharge = recharge;
      const every = optionalCount(source.rechargeEvery, `bonuses[${index}].rechargeEvery`, 1, 99);
      if (every !== undefined) bonus.rechargeEvery = every;
    }
    const stacks = optionalCount(source.stacks, `bonuses[${index}].stacks`, 1, 999);
    if (stacks !== undefined) bonus.stacks = stacks;
    const maxStacks = optionalCount(source.maxStacks, `bonuses[${index}].maxStacks`, 1, 999);
    if (maxStacks !== undefined) bonus.maxStacks = maxStacks;
    const turns = optionalCount(source.turns, `bonuses[${index}].turns`, 1, 99);
    if (turns !== undefined) bonus.turns = turns;
    const origin = boundedText(source.source, `bonuses[${index}].source`, 80);
    if (origin) bonus.source = origin;
    // CD por objetivo (marca de un portador): cd:<efecto>@<id del portador>, solo como marcador 'cooldown' con turnos.
    if (origin && origin.startsWith('cd:') && origin.includes('@')) {
      if (!/^cd:[a-z0-9-]{1,60}@[A-Za-z0-9_-]{1,64}$/.test(origin)) throw new HttpError(400, `bonuses[${index}].source: CD por objetivo no válido`);
      if (bonus.stat !== 'cooldown' || bonus.turns === undefined) throw new HttpError(400, `bonuses[${index}]: el CD por objetivo tiene que ser un marcador 'cooldown' con turnos`);
    }
    const label = boundedText(source.label, `bonuses[${index}].label`, 80);
    if (label) bonus.label = label;
    return bonus;
  });
}

function combatParticipant(value: unknown): CombatParticipant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Cada participante tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  if (typeof source.kind !== 'string' || !COMBAT_PARTICIPANT_KINDS.includes(source.kind as CombatParticipantKind)) {
    throw new HttpError(400, 'kind tiene que ser player, npc, champion o custom');
  }
  const name = boundedText(source.name, 'El nombre del participante', COMBAT_NAME_MAX);
  if (!name) throw new HttpError(400, 'Cada participante necesita un nombre');
  if (typeof source.defeated !== 'boolean') throw new HttpError(400, 'defeated tiene que ser true o false');
  if (!Array.isArray(source.effects)) throw new HttpError(400, 'effects tiene que ser una lista');
  if (source.effects.length > COMBAT_MAX_EFFECTS) {
    throw new HttpError(400, `Como máximo ${COMBAT_MAX_EFFECTS} efectos por participante`);
  }
  const participant: CombatParticipant = {
    id: combatId(source.id, 'participant.id'),
    kind: source.kind as CombatParticipantKind,
    name,
    initiative: typeof source.initiative === 'number' && Number.isFinite(source.initiative)
      ? Math.trunc(source.initiative)
      : 0,
    defeated: source.defeated,
    effects: source.effects.map(combatEffect),
  };
  if ('hp' in source && source.hp !== undefined) participant.hp = nonNegInt(source.hp, 'hp');
  if ('maxHp' in source && source.maxHp !== undefined) participant.maxHp = nonNegInt(source.maxHp, 'maxHp');
  if (participant.hp !== undefined && participant.maxHp !== undefined && participant.maxHp < participant.hp) {
    throw new HttpError(400, 'maxHp no puede ser menor que hp');
  }
  if (source.baseName !== undefined) {
    const baseName = boundedText(source.baseName, 'baseName', COMBAT_NAME_MAX);
    if (baseName) participant.baseName = baseName;
  }
  if (source.copyIndex !== undefined) participant.copyIndex = nonNegInt(source.copyIndex, 'copyIndex');
  if (source.sourceId !== undefined) {
    const sourceId = boundedText(source.sourceId, 'sourceId', 120);
    if (sourceId) participant.sourceId = sourceId;
  }
  if (source.initiativeBonus !== undefined) {
    if (typeof source.initiativeBonus !== 'number' || !Number.isFinite(source.initiativeBonus)) {
      throw new HttpError(400, 'initiativeBonus tiene que ser un número');
    }
    participant.initiativeBonus = Math.trunc(source.initiativeBonus);
  }
  if (source.image !== undefined) {
    const image = boundedText(source.image, 'image', 2000);
    if (image) participant.image = image;
  }
  if (source.currentResource !== undefined) {
    participant.currentResource = nonNegInt(source.currentResource, 'currentResource');
  }
  if (source.tempHp !== undefined && source.tempHp !== null) participant.tempHp = nonNegInt(source.tempHp, 'tempHp');
  if (source.shield !== undefined && source.shield !== null) participant.shield = nonNegInt(source.shield, 'shield');
  if (source.resourceMax !== undefined && source.resourceMax !== null) {
    participant.resourceMax = nonNegInt(source.resourceMax, 'resourceMax');
  }
  for (const field of ['actionsLeft', 'actionsExtra'] as const) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, `${field} tiene que ser un objeto`);
    }
    const raw = value as Record<string, unknown>;
    const actions: { attacks?: number; abilities?: number; items?: number } = {};
    for (const key of ['attacks', 'abilities', 'items'] as const) {
      if (raw[key] === undefined || raw[key] === null) continue;
      const n = nonNegInt(raw[key], `${field}.${key}`);
      if (n > 99) throw new HttpError(400, `${field}.${key} no puede superar 99`);
      if (field === 'actionsExtra' && n === 0) continue;
      actions[key] = n;
    }
    if (Object.keys(actions).length) participant[field] = actions;
  }
  if (source.bonuses !== undefined && source.bonuses !== null) {
    const bonuses = combatBonuses(source.bonuses);
    if (bonuses.length) participant.bonuses = bonuses;
  }
  if (source.vigor !== undefined && source.vigor !== null) {
    const vigor = nonNegInt(source.vigor, 'vigor');
    if (vigor > COMBAT_VIGOR_MAX) throw new HttpError(400, `vigor no puede superar ${COMBAT_VIGOR_MAX}`);
    if (vigor > 0) participant.vigor = vigor;
  }
  if (source.movementUsed !== undefined && source.movementUsed !== null) {
    const used = nonNegInt(source.movementUsed, 'movementUsed');
    if (used > 999) throw new HttpError(400, 'movementUsed no puede superar 999');
    if (used > 0) participant.movementUsed = used;
  }
  if (source.cooldowns !== undefined && source.cooldowns !== null) {
    participant.cooldowns = parsePlayerCooldowns(source.cooldowns);
  }
  if (source.activeEffects !== undefined && source.activeEffects !== null) {
    participant.activeEffects = parsePlayerActiveEffects(source.activeEffects);
  }
  if (source.abilityPhases !== undefined && source.abilityPhases !== null) {
    participant.abilityPhases = parseAbilityPhases(source.abilityPhases);
  }
  if (source.sheet !== undefined && source.sheet !== null) {
    if (participant.kind !== 'champion' && participant.kind !== 'npc') {
      throw new HttpError(400, 'Solo campeones y NPCs llevan copia de ficha');
    }
    participant.sheet = parseCombatSheet(source.sheet);
  }
  return participant;
}

/**
 * Copia de la ficha de un campeón o NPC tomada al añadirlo al combate. Cada participante
 * lee y escribe la suya; el documento base no se toca. Se valida forma y tamaño, no el contenido.
 */
export type CombatSheet = {
  kind: 'champion' | 'npc';
  capturedAt: string;
  data: Record<string, unknown>;
  /** Rango de cada habilidad (Q/W/E/R…) en este combate. */
  abilityRanks?: Record<string, number>;
};

const COMBAT_SHEET_MAX_CHARS = 48_000;
const COMBAT_SHEET_MAX_DEPTH = 12;

function assertPlainJson(value: unknown, depth: number): void {
  if (depth > COMBAT_SHEET_MAX_DEPTH) throw new HttpError(400, 'sheet demasiado anidada');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HttpError(400, 'sheet tiene números no válidos');
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertPlainJson(entry, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!key || key.startsWith('$') || key.includes('\0')) throw new HttpError(400, `Clave no válida en sheet: ${key}`);
      assertPlainJson(entry, depth + 1);
    }
    return;
  }
  throw new HttpError(400, 'sheet solo admite datos JSON');
}

function parseCombatSheet(value: unknown): CombatSheet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'sheet tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  if (source.kind !== 'champion' && source.kind !== 'npc') throw new HttpError(400, 'sheet.kind tiene que ser champion o npc');
  if (!source.data || typeof source.data !== 'object' || Array.isArray(source.data)) {
    throw new HttpError(400, 'sheet.data tiene que ser un objeto');
  }
  assertPlainJson(source.data, 0);
  if (JSON.stringify(source.data).length > COMBAT_SHEET_MAX_CHARS) {
    throw new HttpError(400, `La copia de la ficha no puede superar ${COMBAT_SHEET_MAX_CHARS} caracteres`);
  }
  const sheet: CombatSheet = {
    kind: source.kind,
    capturedAt: typeof source.capturedAt === 'string' && source.capturedAt.length <= 40 ? source.capturedAt : new Date().toISOString(),
    data: source.data as Record<string, unknown>,
  };
  if (source.abilityRanks !== undefined && source.abilityRanks !== null) {
    if (typeof source.abilityRanks !== 'object' || Array.isArray(source.abilityRanks)) {
      throw new HttpError(400, 'sheet.abilityRanks tiene que ser un objeto');
    }
    const ranks: Record<string, number> = {};
    const entries = Object.entries(source.abilityRanks as Record<string, unknown>);
    if (entries.length > 20) throw new HttpError(400, 'Demasiados rangos de habilidad');
    for (const [key, raw] of entries) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(key)) throw new HttpError(400, `Clave de rango no válida: ${key}`);
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 20) {
        throw new HttpError(400, `sheet.abilityRanks[${key}] tiene que ser un entero entre 1 y 20`);
      }
      ranks[key] = raw;
    }
    if (Object.keys(ranks).length) sheet.abilityRanks = ranks;
  }
  return sheet;
}

function parseAbilityPhases(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'abilityPhases tiene que ser un objeto');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 40) throw new HttpError(400, 'Como máximo 40 fases de habilidad');
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > 120 || key.includes('.') || key.startsWith('$') || !key.startsWith('ability:')) {
      throw new HttpError(400, `Clave de fase no válida: ${rawKey}`);
    }
    if (typeof rawVal !== 'number' || !Number.isInteger(rawVal) || rawVal < 0 || rawVal > ABILITY_MAX_VARIANTS) {
      throw new HttpError(400, `abilityPhases[${key}] tiene que ser un entero entre 0 y ${ABILITY_MAX_VARIANTS}`);
    }
    out[key] = rawVal;
  }
  return out;
}

export function parseCombatState(body: unknown): CombatState {
  const source = asObject(body);
  if (typeof source.active !== 'boolean') throw new HttpError(400, 'active tiene que ser true o false');
  if (!Array.isArray(source.participants)) throw new HttpError(400, 'participants tiene que ser una lista');
  if (source.participants.length > COMBAT_MAX_PARTICIPANTS) {
    throw new HttpError(400, `Como máximo ${COMBAT_MAX_PARTICIPANTS} participantes`);
  }
  const participants = source.participants.map(combatParticipant);
  const ids = new Set(participants.map(p => p.id));
  if (ids.size !== participants.length) throw new HttpError(400, 'Hay ids de participante duplicados');
  const round = Math.max(1, nonNegInt(source.round, 'round') || 1);
  let turnIndex = nonNegInt(source.turnIndex, 'turnIndex');
  if (participants.length === 0) turnIndex = 0;
  else if (turnIndex >= participants.length) turnIndex = 0;
  const state: CombatState = { active: source.active, round, turnIndex, participants };
  if (source.vigorPerMove !== undefined && source.vigorPerMove !== null) {
    const rate = source.vigorPerMove;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new HttpError(400, 'vigorPerMove tiene que ser un número entre 0 y 100');
    }
    state.vigorPerMove = Math.round(rate * 100) / 100;
  }
  return state;
}

/** Contadores de stacks por player. Claves: item:<nombre> | ability:<nombre>. */
const STACKS_MAX_KEYS = 80;
const STACKS_KEY_MAX = 120;
const STACKS_VALUE_MAX = 999;

export function parsePlayerStacks(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'stacks tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length > STACKS_MAX_KEYS) {
    throw new HttpError(400, `Como máximo ${STACKS_MAX_KEYS} contadores de stacks`);
  }
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(source)) {
    const key = rawKey.trim();
    if (!key || key.length > STACKS_KEY_MAX || key.includes('.') || key.startsWith('$')) {
      throw new HttpError(400, `Clave de stack no válida: ${rawKey}`);
    }
    // effect:<id del efecto base>: cargas permanentes del personaje (siguen entre combates y sin el ítem).
    if (!key.startsWith('item:') && !key.startsWith('ability:') && !key.startsWith('effect:')) {
      throw new HttpError(400, `Clave de stack debe empezar por item:, ability: o effect: (${key})`);
    }
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || !Number.isInteger(rawVal) || rawVal < 0) {
      throw new HttpError(400, `stacks[${key}] tiene que ser un entero ≥ 0`);
    }
    if (rawVal > STACKS_VALUE_MAX) {
      throw new HttpError(400, `stacks[${key}] no puede superar ${STACKS_VALUE_MAX}`);
    }
    out[key] = rawVal;
  }
  return out;
}


/** Cooldowns restantes por player. Claves: item:<nombre> | ability:<nombre>. Unidad: turnos. */
const COOLDOWNS_MAX_KEYS = 80;
const COOLDOWNS_KEY_MAX = 120;
const COOLDOWNS_VALUE_MAX = 999;

export function parsePlayerCooldowns(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'cooldowns tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length > COOLDOWNS_MAX_KEYS) {
    throw new HttpError(400, `Como máximo ${COOLDOWNS_MAX_KEYS} cooldowns`);
  }
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(source)) {
    const key = rawKey.trim();
    if (!key || key.length > COOLDOWNS_KEY_MAX || key.includes('.') || key.startsWith('$')) {
      throw new HttpError(400, `Clave de cooldown no válida: ${rawKey}`);
    }
    if (!key.startsWith('item:') && !key.startsWith('ability:')) {
      throw new HttpError(400, `Clave de cooldown debe empezar por item: o ability: (${key})`);
    }
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || !Number.isInteger(rawVal) || rawVal < 0) {
      throw new HttpError(400, `cooldowns[${key}] tiene que ser un entero ≥ 0`);
    }
    if (rawVal > COOLDOWNS_VALUE_MAX) {
      throw new HttpError(400, `cooldowns[${key}] no puede superar ${COOLDOWNS_VALUE_MAX}`);
    }
    out[key] = rawVal;
  }
  return out;
}

const ACTIVE_EFFECTS_MAX_KEYS = 80;
const ACTIVE_EFFECTS_KEY_MAX = 120;
const ACTIVE_EFFECTS_VALUE_MAX = 999;

/** Efectos activos. Claves: item:<nombre> | ability:<nombre>. Unidad: turnos. */
export function parsePlayerActiveEffects(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'activeEffects tiene que ser un objeto');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length > ACTIVE_EFFECTS_MAX_KEYS) {
    throw new HttpError(400, `Como máximo ${ACTIVE_EFFECTS_MAX_KEYS} activeEffects`);
  }
  const out: Record<string, number> = {};
  for (const [rawKey, rawVal] of Object.entries(source)) {
    const key = rawKey.trim();
    if (!key || key.length > ACTIVE_EFFECTS_KEY_MAX || key.includes('.') || key.startsWith('$')) {
      throw new HttpError(400, `Clave de activeEffect no válida: ${rawKey}`);
    }
    if (!key.startsWith('item:') && !key.startsWith('ability:')) {
      throw new HttpError(400, `Clave de activeEffect debe empezar por item: o ability: (${key})`);
    }
    if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || !Number.isInteger(rawVal) || rawVal < 0) {
      throw new HttpError(400, `activeEffects[${key}] tiene que ser un entero ≥ 0`);
    }
    if (rawVal > ACTIVE_EFFECTS_VALUE_MAX) {
      throw new HttpError(400, `activeEffects[${key}] no puede superar ${ACTIVE_EFFECTS_VALUE_MAX}`);
    }
    out[key] = rawVal;
  }
  return out;
}
