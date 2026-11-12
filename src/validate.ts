import { RANKED_SLOTS, maxRank, type RankedSlot } from './abilityRanks';
import { RESOURCE_IDS, isResourceId, type ResourceId } from './resources';
import { HttpError } from './errors';
import { parseAreaPattern, type AreaPattern } from './areaPattern';

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
};

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
 * («armed» = siguiente AA potenciado, «cooldown» = efecto en enfriamiento); los marcadores no suman stats.
 */
export const COMBAT_MARKER_STATS = ['armed', 'cooldown', 'charges'] as const;
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
export const NPC_STAT_KEYS = ['hp', 'mana', 'ac', 'mr', 'spe', 'ad', 'ap'] as const;
export type NpcStatKey = (typeof NPC_STAT_KEYS)[number];
export type NpcStats = Partial<Record<NpcStatKey, number>>;

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

function parseNpcStats(value: unknown): NpcStats {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'stats tiene que ser un objeto');
  const source = value as Record<string, unknown>;
  const stats: NpcStats = {};
  for (const key of NPC_STAT_KEYS) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new HttpError(400, `stats.${key} tiene que ser un número`);
    stats[key] = raw;
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
  /** Origen: item:<nombre> o ability:<nombre>. */
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
    if (!key || key.includes('.') || key.startsWith('$') || (!key.startsWith('item:') && !key.startsWith('ability:'))) {
      throw new HttpError(400, 'effect.source tiene que ser item:<nombre> o ability:<nombre>');
    }
    effect.source = key;
  }
  return effect;
}

/** Bonus temporal de stats en combate: amount × stacks se suma al total; turns baja al empezar su turno. */
export type CombatBonus = {
  id: string;
  /** Stat de la ficha o marcador de efecto con nombre (armed / cooldown / charges). */
  stat: SheetStatKey | 'armed' | 'cooldown' | 'charges';
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