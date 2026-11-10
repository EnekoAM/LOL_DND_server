import { ObjectId, type Collection, type Document, type Filter } from 'mongodb';
import { getDb } from './db';
import { HttpError, logError } from './errors';
import { buildLootItems } from './lootItems';
import { RANKED_SLOTS, canRaise, normalizeRanks, ultRankCap, unassignedPoints, type AbilityRanks } from './abilityRanks';
import { LOOT_RULE_KEYS, parseLootRules } from './validate';
import { FAQ_SEED } from './faqSeed';
import { deleteNotesFor } from './playerNotes';
import type { RelationInput, RelationPatch, RelationRef, AugmentInput, NpcInput, FaqInput, FaqPatch, MapPoiInput, MapPoiKind, MapPoiPatch, ChampionAbility, ChampionFieldsPatch, CombatState, HistoryKind, ItemUpdate, LootRules, LootRulesPatch, PartyPatch, PlayerPatch, PlayerReplace, PlayerSheet, RolePatch, RollRecord, ShopOrder, TicketInput, TicketStatus } from './validate';

const PUBLIC = { projection: { _id: 0, order: 0 } };
const CI = { locale: 'es', strength: 2 } as const;

type PlayerDoc = Document & {
  name: string;
  rol?: string;
  order?: number;
  abilities?: Record<string, string | null>;
  sheet?: PlayerSheet;
  abilityRanks?: Partial<AbilityRanks>;
  unassignedPoints?: number;
  unlocks?: Partial<Record<'quest' | 'aumentos' | 'questTop' | 'questTopAssigned' | 'questVisible' | 'aumentosVisible', boolean>>;
  quests?: PlayerPatch['quests'];
  aumentos?: PlayerPatch['aumentos'];
  mechanic?: PlayerPatch['mechanic'];
};

type StringIdDoc = Document & { _id: string };

async function collection(name: string): Promise<Collection> {
  return (await getDb()).collection(name);
}

async function singleton(name: string): Promise<Collection<StringIdDoc>> {
  return (await getDb()).collection<StringIdDoc>(name);
}

async function one(col: Collection, filter: Filter<Document>, missing: string) {
  const doc = await col.findOne(filter, { ...PUBLIC, collation: CI });
  if (!doc) throw new HttpError(404, missing);
  return doc;
}

export async function getChampions(champion?: string) {
  const col = await collection('champions');
  if (!champion) return col.find({}, PUBLIC).sort({ order: 1 }).toArray();
  return one(col, { champion }, `No existe el campeón ${champion}`);
}

export async function updateChampionAbility(champion: string, slot: string, ability: ChampionAbility) {
  const col = await collection('champions');
  const existing = await col.findOne({ champion }, { collation: CI });
  if (!existing) throw new HttpError(404, `No existe el campeón ${champion}`);
  await col.updateOne(
    { _id: existing._id },
    { $set: { [`abilities.${slot}`]: ability, updatedAt: new Date().toISOString() } },
  );
  return getChampions(String(existing.champion));
}

export async function updateChampionFields(champion: string, patch: ChampionFieldsPatch) {
  const col = await collection('champions');
  const existing = await col.findOne({ champion }, { collation: CI });
  if (!existing) throw new HttpError(404, `No existe el campeón ${champion}`);
  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const $unset: Record<string, ''> = {};
  if (patch.level !== undefined) $set.level = patch.level;
  if (patch.roleId !== undefined) {
    await getRole(patch.roleId);
    $set.roleId = patch.roleId;
  }
  if (patch.role !== undefined) $set.role = patch.role;
  if (patch.image !== undefined) $set.image = patch.image;
  if (patch.active !== undefined) $set.active = patch.active;
  if (patch.equipamiento !== undefined) $set.equipamiento = patch.equipamiento;
  if (patch.background !== undefined) {
    if (patch.background === null) $unset.background = '';
    else $set.background = patch.background;
  }
  const update: Record<string, unknown> = { $set };
  if (Object.keys($unset).length) update.$unset = $unset;
  await col.updateOne({ _id: existing._id }, update);
  return getChampions(String(existing.champion));
}

export async function getItems(nombre?: string) {
  const col = await collection('items');
  if (!nombre) return col.find({}, PUBLIC).sort({ order: 1 }).toArray();
  return one(col, { nombre }, `No existe el item ${nombre}`);
}

/**
 * Cambia la definición de un ítem (rareza, efectos, stats y coste).
 * No toca nombre ni cantidad: el nombre es la referencia que usan jugadores, builds, recetas e historiales.
 * Las stats se fijan una a una para no borrar claves que el formulario no conozca.
 */
export async function updateItem(nombre: string, update: ItemUpdate) {
  const trimmed = nombre.trim();
  if (!trimmed) throw new HttpError(400, 'Falta el nombre del ítem');
  const col = await collection('items');
  const existing = await col.findOne({ nombre: trimmed }, { collation: CI });
  if (!existing) throw new HttpError(404, `No existe el item ${trimmed}`);

  const set: Document = {
    rareza: update.rareza,
    efecto: { pasiva: update.efecto.pasiva, activa: update.efecto.activa },
    updatedAt: new Date().toISOString(),
  };
  const hasStats = !!existing.stats && typeof existing.stats === 'object' && !Array.isArray(existing.stats);
  if (hasStats) {
    for (const [key, value] of Object.entries(update.stats)) set[`stats.${key}`] = value;
  } else {
    set.stats = update.stats;
  }
  if (typeof update.coste === 'number') set.coste = update.coste;
  if (typeof update.hasStacks === 'boolean') set.hasStacks = update.hasStacks;
  const unset: Record<string, ''> = {};
  if (update.coste === null) unset.coste = '';
  if (update.hasStacks === false) {
    unset.maxStacks = '';
  } else if (update.maxStacks === null) {
    unset.maxStacks = '';
  } else if (typeof update.maxStacks === 'number') {
    set.maxStacks = update.maxStacks;
  }
  if (update.cooldown === null) unset.cooldown = '';
  else if (typeof update.cooldown === 'number') set.cooldown = update.cooldown;
  if (update.effectDuration === null) unset.effectDuration = '';
  else if (typeof update.effectDuration === 'number') set.effectDuration = update.effectDuration;

  const updateDoc: Document = Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set };
  await col.updateOne({ _id: existing._id }, updateDoc);
  return getItems(String(existing.nombre));
}

/** Hora de España (península), como "01/01/2026 12:00:00". */
function rollTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '00';
  const hour = value('hour') === '24' ? '00' : value('hour');
  return `${value('day')}/${value('month')}/${value('year')} ${hour}:${value('minute')}:${value('second')}`;
}

/** Suma una copia al stock y deja la tirada en rollHistoric. */
export async function grantItem(nombre: string, roll: RollRecord) {
  const trimmed = nombre.trim();
  if (!trimmed) throw new HttpError(400, 'Falta el nombre del ítem');
  const col = await collection('items');
  const existing = await col.findOne({ nombre: trimmed }, { collation: CI });
  if (!existing) throw new HttpError(404, `No existe el item ${trimmed}`);

  const item = String(existing.nombre);
  await col.updateOne(
    { _id: existing._id },
    { $inc: { cantidad: 1 }, $set: { updatedAt: new Date().toISOString() } },
  );
  await (await collection('rollHistoric')).insertOne({
    timestamp: rollTimestamp(),
    createdAt: new Date(),
    item,
    tirada: roll.tirada,
    rareza: roll.rareza,
    reverted: false,
  });
  return getItems(item);
}

const itemKey = (name: string) => name.trim().toLowerCase();

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recipeNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, 'Este ítem no se craftea');
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) throw new HttpError(400, 'La receta del ítem está mal formada');
    names.push(entry.trim());
  }
  return names;
}

/** Una receta puede pedir el mismo ingrediente varias veces. */
function groupNeeds(names: string[]): { key: string; label: string; needed: number }[] {
  const grouped = new Map<string, { key: string; label: string; needed: number }>();
  for (const name of names) {
    const key = itemKey(name);
    const current = grouped.get(key);
    if (current) current.needed += 1;
    else grouped.set(key, { key, label: name, needed: 1 });
  }
  return [...grouped.values()];
}

async function equippedCounts(): Promise<Map<string, number>> {
  const docs = await (await players()).find({}, { projection: { equipamiento: 1 } }).toArray();
  const counts = new Map<string, number>();
  for (const doc of docs) {
    if (!Array.isArray(doc.equipamiento)) continue;
    for (const name of doc.equipamiento) {
      if (typeof name !== 'string' || !name.trim()) continue;
      const key = itemKey(name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function numericCost(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** La venta paga el 70% del coste de cada copia, al oro más cercano. */
function sellUnit(cost: number): number {
  return Math.round((cost * 70) / 100);
}


function rarityKey(rareza: unknown): string {
  if (typeof rareza !== 'string') return '';
  return rareza.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/** Los prismáticos no se compran, aunque tengan coste. Se pueden vender y craftear. */
function isPrismatic(rareza: unknown): boolean {
  return rarityKey(rareza) === 'prismatico';
}

function isStarter(rareza: unknown): boolean {
  return rarityKey(rareza) === 'inicial';
}

/** Las botas no se compran: se mejoran en crafteo (y con item de mision las tochas). */
function isBoots(rareza: unknown): boolean {
  return rarityKey(rareza) === 'botas';
}

/** Tasa de crafteo: 10% del precio (Math.round). Misma regla en web recipe.ts. */
const CRAFT_FEE_RATE = 0.1;

function craftPercentFee(coste: number): number {
  if (!Number.isFinite(coste) || coste <= 0) return 0;
  return Math.round(coste * CRAFT_FEE_RATE);
}

/**
 * Diferencia del paso: max(0, precio − suma hijos).
 * Si los componentes suman más, se clampa a 0 (solo se cobra el 10%).
 * Misma cuenta en web recipe.ts.
 */
function craftDifference(resultCost: number, pieceCosts: number[]): number {
  const covered = pieceCosts.reduce((sum, cost) => sum + cost, 0);
  const restante = resultCost - covered;
  return restante > 0 ? restante : 0;
}

/** Oro de un crafteo suelto / de un paso: diferencia + 10%. */
function craftGold(resultCost: number, pieceCosts: number[]): number {
  return craftDifference(resultCost, pieceCosts) + craftPercentFee(resultCost);
}

async function chargeGold(amount: number, updatedAt: string): Promise<void> {
  if (amount <= 0) return;
  const col = await singleton('party');
  const paid = await col.updateOne(
    { _id: 'current', gold: { $gte: amount } },
    { $inc: { gold: -amount }, $set: { updatedAt } },
  );
  if (paid.modifiedCount === 1) return;
  const current = await col.findOne({ _id: 'current' }, { projection: { gold: 1 } });
  if (!current) throw new HttpError(404, 'No hay grupo');
  const have = typeof current.gold === 'number' ? current.gold : 0;
  throw new HttpError(400, `Falta oro (tienes ${have.toLocaleString('es-ES')}, hacen falta ${amount.toLocaleString('es-ES')})`);
}

async function refundGold(amount: number): Promise<void> {
  if (amount <= 0) return;
  const result = await (await singleton('party')).updateOne(
    { _id: 'current' },
    { $inc: { gold: amount }, $set: { updatedAt: new Date().toISOString() } },
  );
  if (result.matchedCount !== 1) throw new HttpError(404, 'No hay grupo');
}

async function readPartyGold(): Promise<number> {
  const { gold } = (await getParty()) as { gold?: unknown };
  return typeof gold === 'number' ? gold : 0;
}

/**
 * Gasta las copias libres de la receta (craftsFrom), el oro que falta hasta el coste,
 * y suma una del resultado. Lo que lleva puesto un jugador no se puede gastar.
 */
export async function craftItem(nombre: string) {
  const trimmed = nombre.trim();
  if (!trimmed) throw new HttpError(400, 'Falta el nombre del ítem');

  const col = await collection('items');
  const docs = await col.find({}).toArray();
  type ItemId = (typeof docs)[number]['_id'];
  const byKey = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    if (typeof doc.nombre !== 'string') continue;
    const key = itemKey(doc.nombre);
    if (!byKey.has(key)) byKey.set(key, doc);
  }

  const target = byKey.get(itemKey(trimmed));
  if (!target) throw new HttpError(404, `No existe el item ${trimmed}`);

  const needs = groupNeeds(recipeNames(target.craftsFrom));
  const equipped = await equippedCounts();
  const plan: { id: ItemId; key: string; nombre: string; needed: number }[] = [];
  const missing: string[] = [];
  const short: string[] = [];

  for (const need of needs) {
    const doc = byKey.get(need.key);
    if (!doc || typeof doc.nombre !== 'string') {
      missing.push(need.label);
      continue;
    }
    const available = Math.max(0, countOf(doc.cantidad) - (equipped.get(need.key) ?? 0));
    if (available < need.needed) short.push(`${doc.nombre} (${available}/${need.needed})`);
    plan.push({ id: doc._id, key: need.key, nombre: doc.nombre, needed: need.needed });
  }

  if (missing.length > 0) throw new HttpError(400, `No existe el ingrediente ${missing.join(', ')}`);
  if (short.length > 0) throw new HttpError(400, `Faltan ingredientes: ${short.join(', ')}`);

  const pieceCosts: number[] = [];
  for (const step of plan) {
    const cost = numericCost(byKey.get(step.key)?.coste);
    for (let index = 0; index < step.needed; index += 1) pieceCosts.push(cost);
  }
  const gold = craftGold(numericCost(target.coste), pieceCosts);
  if (gold <= 0) throw new HttpError(400, 'Este crafteo tiene que costar oro');

  const applied: { id: ItemId; amount: number }[] = [];
  const updatedAt = new Date().toISOString();
  let createdCopy = false;
  let chargedGold = 0;
  try {
    if (gold > 0) {
      await chargeGold(gold, updatedAt);
      chargedGold = gold;
    }

    for (const step of plan) {
      const reserved = equipped.get(step.key) ?? 0;
      const result = await col.updateOne(
        { _id: step.id, cantidad: { $gte: reserved + step.needed } },
        { $inc: { cantidad: -step.needed }, $set: { updatedAt } },
      );
      if (result.modifiedCount !== 1) {
        throw new HttpError(409, 'El stock cambió mientras se crafteaba. Vuelve a intentarlo');
      }
      applied.push({ id: step.id, amount: step.needed });
    }

    const created = await col.updateOne(
      { _id: target._id },
      { $inc: { cantidad: 1 }, $set: { updatedAt } },
    );
    if (created.matchedCount !== 1) throw new HttpError(404, `No existe el item ${trimmed}`);
    createdCopy = true;

    await (await collection('craftHistoric')).insertOne({
      timestamp: rollTimestamp(),
      createdAt: new Date(),
      item: String(target.nombre),
      ingredients: plan.map(step => ({ nombre: step.nombre, cantidad: step.needed })),
      oro: gold,
      reverted: false,
    });
  } catch (error) {
    try {
      if (createdCopy) await col.updateOne({ _id: target._id }, { $inc: { cantidad: -1 } });
      for (const step of applied.reverse()) {
        await col.updateOne({ _id: step.id }, { $inc: { cantidad: step.amount } });
      }
      if (chargedGold > 0) await refundGold(chargedGold);
    } catch (rollbackError) {
      logError(rollbackError);
    }
    throw error;
  }

  return {
    items: await col.find({ _id: { $in: [target._id, ...plan.map(step => step.id)] } }, PUBLIC).toArray(),
    gold: await readPartyGold(),
  };
}

/** Coste de un paso del plan recursivo. Misma regla que web craftStepCost. */
function planStepGold(resultCost: number, pieceCosts: number[], _rareza?: unknown, _role?: 'final' | 'intermediate'): {
  difference: number;
  fee: number;
  gold: number;
} {
  const difference = craftDifference(resultCost, pieceCosts);
  const fee = craftPercentFee(resultCost);
  return { difference, fee, gold: difference + fee };
}

function isShopPurchasableDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const rec = doc as { coste?: unknown; rareza?: unknown };
  if (numericCost(rec.coste) <= 0) return false;
  if (isPrismatic(rec.rareza) || isStarter(rec.rareza) || isBoots(rec.rareza)) return false;
  return true;
}

export type CraftRecursiveOptions = {
  /** Compra piezas básicas faltantes al precio de tienda y craftea. */
  buyMissing?: boolean;
  /** Solo calcula y valida; no muta oro ni stock. */
  preview?: boolean;
};

/**
 * Crafteo recursivo: prepara intermedios si hace falta y cobra el oro del plan de una vez.
 * Con buyMissing: compra piezas básicas faltantes (misma regla que la tienda) y las usa en el craft.
 * Con preview: devuelve el desglose sin cobrar ni mutar.
 * Oro siempre recalculado en servidor.
 */
export async function craftRecursive(nombre: string, opts: CraftRecursiveOptions = {}) {
  const buyMissing = opts.buyMissing === true;
  const preview = opts.preview === true;
  const trimmed = nombre.trim();
  if (!trimmed) throw new HttpError(400, 'Falta el nombre del ítem');

  const col = await collection('items');
  const docs = await col.find({}).toArray();
  type ItemId = (typeof docs)[number]['_id'];
  const byKey = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    if (typeof doc.nombre !== 'string') continue;
    const key = itemKey(doc.nombre);
    if (!byKey.has(key)) byKey.set(key, doc);
  }

  const target = byKey.get(itemKey(trimmed));
  if (!target || typeof target.nombre !== 'string') throw new HttpError(404, `No existe el item ${trimmed}`);
  if (!Array.isArray(target.craftsFrom) || target.craftsFrom.length === 0) {
    throw new HttpError(400, `${target.nombre} no se craftea`);
  }

  const equipped = await equippedCounts();
  const bag = new Map<string, number>();
  for (const doc of docs) {
    if (typeof doc.nombre !== 'string') continue;
    const key = itemKey(doc.nombre);
    const available = Math.max(0, countOf(doc.cantidad) - (equipped.get(key) ?? 0));
    if (available > 0) bag.set(key, available);
  }

  type PlannedStep = {
    target: (typeof docs)[number];
    role: 'final' | 'intermediate';
    needs: { key: string; nombre: string; id: ItemId; needed: number }[];
    gold: number;
    difference: number;
    fee: number;
  };

  type PurchaseLine = {
    key: string;
    nombre: string;
    id: ItemId;
    qty: number;
    unitCost: number;
    totalCost: number;
  };

  const planned: PlannedStep[] = [];
  const purchaseMap = new Map<string, PurchaseLine>();
  let packageGold = 0;

  const addPurchase = (doc: (typeof docs)[number], qty: number) => {
    if (typeof doc.nombre !== 'string') throw new HttpError(400, 'Ítem sin nombre');
    if (!isShopPurchasableDoc(doc)) {
      throw new HttpError(400, `${doc.nombre} no se puede comprar`);
    }
    const key = itemKey(doc.nombre);
    const unit = numericCost(doc.coste);
    const prev = purchaseMap.get(key);
    if (prev) {
      prev.qty += qty;
      prev.totalCost += unit * qty;
    } else {
      purchaseMap.set(key, {
        key,
        nombre: doc.nombre,
        id: doc._id as ItemId,
        qty,
        unitCost: unit,
        totalCost: unit * qty,
      });
    }
    // Entra al almacén virtual para el resto del plan.
    bag.set(key, (bag.get(key) ?? 0) + qty);
  };

  const craftOne = (doc: (typeof docs)[number], role: 'final' | 'intermediate', depth: number, seen: Set<string>) => {
    if (depth > 8) throw new HttpError(400, 'Receta demasiado profunda');
    if (typeof doc.nombre !== 'string') throw new HttpError(400, 'Ítem sin nombre');
    const self = itemKey(doc.nombre);
    if (seen.has(self)) throw new HttpError(400, `Ciclo en receta: ${doc.nombre}`);
    const nextSeen = new Set(seen);
    nextSeen.add(self);

    const needs = groupNeeds(recipeNames(doc.craftsFrom));
    const resolved: PlannedStep['needs'] = [];
    const pieceCosts: number[] = [];

    for (const need of needs) {
      const child = byKey.get(need.key);
      if (!child || typeof child.nombre !== 'string') {
        throw new HttpError(400, `No existe el ingrediente ${need.label}`);
      }
      for (let unit = 0; unit < need.needed; unit += 1) {
        satisfy(child, depth + 1, nextSeen);
        pieceCosts.push(numericCost(child.coste));
      }
      resolved.push({
        key: need.key,
        nombre: child.nombre,
        id: child._id as ItemId,
        needed: need.needed,
      });
    }

    const cost = planStepGold(numericCost(doc.coste), pieceCosts, doc.rareza, role);
    packageGold += cost.gold;
    planned.push({
      target: doc,
      role,
      needs: resolved,
      gold: cost.gold,
      difference: cost.difference,
      fee: cost.fee,
    });
    bag.set(self, (bag.get(self) ?? 0) + 1);
  };

  const satisfy = (doc: (typeof docs)[number], depth: number, seen: Set<string>) => {
    if (typeof doc.nombre !== 'string') throw new HttpError(400, 'Ítem sin nombre');
    const self = itemKey(doc.nombre);
    const have = bag.get(self) ?? 0;
    if (have >= 1) {
      bag.set(self, have - 1);
      return;
    }
    if (!Array.isArray(doc.craftsFrom) || doc.craftsFrom.length === 0) {
      if (buyMissing) {
        addPurchase(doc, 1);
        const afterBuy = bag.get(self) ?? 0;
        if (afterBuy < 1) throw new HttpError(400, `No se pudo comprar ${doc.nombre}`);
        bag.set(self, afterBuy - 1);
        return;
      }
      throw new HttpError(400, `Faltan ingredientes: ${doc.nombre} (0/1)`);
    }
    craftOne(doc, 'intermediate', depth, seen);
    const after = bag.get(self) ?? 0;
    if (after < 1) throw new HttpError(400, `No se pudo preparar ${doc.nombre}`);
    bag.set(self, after - 1);
  };

  craftOne(target, 'final', 0, new Set());

  const directBuyGold = isShopPurchasableDoc(target) ? numericCost(target.coste) : 0;
  if (packageGold <= 0) throw new HttpError(400, 'Este crafteo tiene que costar oro');

  const purchases = [...purchaseMap.values()];
  const buyGold = purchases.reduce((sum, line) => sum + line.totalCost, 0);
  if (purchases.length > 0 && !buyMissing) {
    throw new HttpError(400, 'Faltan ingredientes');
  }
  const totalGold = packageGold + buyGold;
  const cheaperDirect = directBuyGold > 0 && totalGold > directBuyGold;

  if (preview) {
    return {
      preview: true as const,
      item: String(target.nombre),
      purchases: purchases.map(line => ({
        nombre: line.nombre,
        cantidad: line.qty,
        unitCost: line.unitCost,
        oro: line.totalCost,
      })),
      steps: planned.map(step => ({
        item: String(step.target.nombre),
        role: step.role,
        diferencia: step.difference,
        tasa: step.fee,
        oro: step.gold,
        ingredients: step.needs.map(need => ({ nombre: need.nombre, cantidad: need.needed })),
      })),
      buyGold,
      craftGold: packageGold,
      oro: totalGold,
      directBuyGold,
      cheaperDirect,
      gold: await readPartyGold(),
    };
  }

  const updatedAt = new Date().toISOString();
  const touchedIds = new Set<ItemId>([target._id as ItemId]);
  const consumed: { id: ItemId; amount: number }[] = [];
  const produced: ItemId[] = [];
  const boughtApplied: { id: ItemId; amount: number }[] = [];
  let chargedGold = 0;
  const historyIds: { kind: 'buy' | 'craft'; id: unknown }[] = [];

  try {
    await chargeGold(totalGold, updatedAt);
    chargedGold = totalGold;

    // 1) Comprar piezas faltantes (entran al almacén).
    for (const line of purchases) {
      touchedIds.add(line.id);
      const result = await col.updateOne(
        { _id: line.id },
        { $inc: { cantidad: line.qty }, $set: { updatedAt } },
      );
      if (result.matchedCount !== 1) throw new HttpError(404, `No existe el item ${line.nombre}`);
      boughtApplied.push({ id: line.id, amount: line.qty });

      const buyHist = await (await collection('buyHistoric')).insertOne({
        timestamp: rollTimestamp(),
        createdAt: new Date(),
        item: line.nombre,
        cantidad: line.qty,
        oro: line.totalCost,
        via: 'craft',
        reverted: false,
      });
      historyIds.push({ kind: 'buy', id: buyHist.insertedId });
    }

    // 2) Craftear en orden (consume también lo recién comprado).
    for (const step of planned) {
      for (const need of step.needs) {
        touchedIds.add(need.id);
        const reserved = equipped.get(need.key) ?? 0;
        const result = await col.updateOne(
          { _id: need.id, cantidad: { $gte: reserved + need.needed } },
          { $inc: { cantidad: -need.needed }, $set: { updatedAt } },
        );
        if (result.modifiedCount !== 1) {
          throw new HttpError(409, 'El stock cambió mientras se crafteaba. Vuelve a intentarlo');
        }
        consumed.push({ id: need.id, amount: need.needed });
      }
      touchedIds.add(step.target._id as ItemId);
      const created = await col.updateOne(
        { _id: step.target._id },
        { $inc: { cantidad: 1 }, $set: { updatedAt } },
      );
      if (created.matchedCount !== 1) throw new HttpError(404, `No existe el item ${String(step.target.nombre)}`);
      produced.push(step.target._id as ItemId);
    }

    const leafIngredients = new Map<string, { nombre: string; cantidad: number }>();
    for (const step of planned) {
      for (const need of step.needs) {
        const childPlanned = planned.some(p => itemKey(String(p.target.nombre)) === need.key);
        if (childPlanned) continue;
        const prev = leafIngredients.get(need.key);
        if (prev) prev.cantidad += need.needed;
        else leafIngredients.set(need.key, { nombre: need.nombre, cantidad: need.needed });
      }
    }

    const craftHist = await (await collection('craftHistoric')).insertOne({
      timestamp: rollTimestamp(),
      createdAt: new Date(),
      item: String(target.nombre),
      ingredients: [...leafIngredients.values()],
      oro: totalGold,
      craftGold: packageGold,
      buyGold,
      purchases: purchases.map(line => ({ nombre: line.nombre, cantidad: line.qty, oro: line.totalCost })),
      recursive: true,
      buyMissing: purchases.length > 0,
      steps: planned.map(step => ({
        item: String(step.target.nombre),
        role: step.role,
        oro: step.gold,
        ingredients: step.needs.map(need => ({ nombre: need.nombre, cantidad: need.needed })),
      })),
      reverted: false,
    });
    historyIds.push({ kind: 'craft', id: craftHist.insertedId });
  } catch (error) {
    try {
      for (const id of produced.reverse()) {
        await col.updateOne({ _id: id }, { $inc: { cantidad: -1 } });
      }
      for (const entry of consumed.reverse()) {
        await col.updateOne({ _id: entry.id }, { $inc: { cantidad: entry.amount } });
      }
      for (const entry of boughtApplied.reverse()) {
        await col.updateOne({ _id: entry.id }, { $inc: { cantidad: -entry.amount } });
      }
      for (const hist of historyIds.reverse()) {
        const name = hist.kind === 'buy' ? 'buyHistoric' : 'craftHistoric';
        await (await collection(name)).deleteOne({ _id: hist.id as never });
      }
      if (chargedGold > 0) await refundGold(chargedGold);
    } catch (rollbackError) {
      logError(rollbackError);
    }
    throw error;
  }

  return {
    items: await col.find({ _id: { $in: [...touchedIds] } }, PUBLIC).toArray(),
    gold: await readPartyGold(),
    oro: totalGold,
    buyGold,
    craftGold: packageGold,
    purchases: purchases.map(line => ({
      nombre: line.nombre,
      cantidad: line.qty,
      oro: line.totalCost,
    })),
    cheaperDirect,
    directBuyGold,
  };
}



/** Compra al coste o vende al 70%. Lo equipado no se puede vender. */
export async function tradeShop(order: ShopOrder) {
  const col = await collection('items');
  const docs = await col.find({}).toArray();
  type ItemId = (typeof docs)[number]['_id'];
  const byKey = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    if (typeof doc.nombre !== 'string') continue;
    const key = itemKey(doc.nombre);
    if (!byKey.has(key)) byKey.set(key, doc);
  }

  const equipped = order.mode === 'venta' ? await equippedCounts() : new Map<string, number>();
  const plan: { id: ItemId; nombre: string; cantidad: number; reserved: number; oro: number }[] = [];
  let total = 0;

  for (const line of order.lines) {
    const doc = byKey.get(itemKey(line.nombre));
    if (!doc || typeof doc.nombre !== 'string') throw new HttpError(404, `No existe el item ${line.nombre}`);
    if (order.mode === 'compra' && (numericCost(doc.coste) <= 0 || isPrismatic(doc.rareza) || isStarter(doc.rareza) || isBoots(doc.rareza))) {
      throw new HttpError(400, `${doc.nombre} no se compra`);
    }
    const reserved = equipped.get(itemKey(doc.nombre)) ?? 0;
    if (order.mode === 'venta') {
      const available = Math.max(0, countOf(doc.cantidad) - reserved);
      if (available < line.cantidad) {
        throw new HttpError(400, countOf(doc.cantidad) > available
          ? `No se puede vender ${doc.nombre}: las copias equipadas no se gastan`
          : `No hay tantas copias de ${doc.nombre}`);
      }
    }
    const unit = numericCost(doc.coste);
    const oro = (order.mode === 'venta' ? sellUnit(unit) : unit) * line.cantidad;
    total += oro;
    plan.push({ id: doc._id, nombre: doc.nombre, cantidad: line.cantidad, reserved, oro });
  }

  const updatedAt = new Date().toISOString();
  const applied: { id: ItemId; cantidad: number }[] = [];
  const historyName = order.mode === 'compra' ? 'buyHistoric' : 'sellHistoric';
  const history = await collection(historyName);
  const historyIds: ObjectId[] = [];
  const recordedAt = new Date();
  let charged = 0;
  let paidOut = 0;
  try {
    if (order.mode === 'compra' && total > 0) {
      await chargeGold(total, updatedAt);
      charged = total;
    }
    for (const step of plan) {
      if (order.mode === 'compra') {
        const result = await col.updateOne(
          { _id: step.id },
          { $inc: { cantidad: step.cantidad }, $set: { updatedAt } },
        );
        if (result.matchedCount !== 1) throw new HttpError(404, `No existe el item ${step.nombre}`);
      } else {
        const result = await col.updateOne(
          { _id: step.id, cantidad: { $gte: step.reserved + step.cantidad } },
          { $inc: { cantidad: -step.cantidad }, $set: { updatedAt } },
        );
        if (result.modifiedCount !== 1) {
          throw new HttpError(409, 'El stock cambió mientras se vendía. Vuelve a intentarlo');
        }
      }
      applied.push({ id: step.id, cantidad: step.cantidad });
    }
    if (order.mode === 'venta' && total > 0) {
      await refundGold(total);
      paidOut = total;
    }
    for (const step of plan) {
      const inserted = await history.insertOne({
        timestamp: rollTimestamp(recordedAt),
        createdAt: recordedAt,
        item: step.nombre,
        cantidad: step.cantidad,
        oro: step.oro,
        reverted: false,
      });
      historyIds.push(inserted.insertedId);
    }
  } catch (error) {
    try {
      if (historyIds.length > 0) await history.deleteMany({ _id: { $in: historyIds } });
      for (const step of applied.reverse()) {
        const delta = order.mode === 'compra' ? -step.cantidad : step.cantidad;
        await col.updateOne({ _id: step.id }, { $inc: { cantidad: delta } });
      }
      if (charged > 0) await refundGold(charged);
      if (paidOut > 0) await chargeGold(paidOut, new Date().toISOString());
    } catch (rollbackError) {
      logError(rollbackError);
    }
    throw error;
  }

  return {
    items: await col.find({ _id: { $in: plan.map(step => step.id) } }, PUBLIC).toArray(),
    gold: await readPartyGold(),
  };
}

const LOOT_DOC_ID = 'tables';
const MISSING_LOOT_RULES = 'Faltan las reglas de botín en Mongo. Ejecuta npm run migrate:loot';

/** Reglas de botín guardadas en loot/tables (rolls, Drop básico/épico/legendario y wildCard). */
async function readLootRules(): Promise<LootRules> {
  const projection = Object.fromEntries(LOOT_RULE_KEYS.map(key => [key, 1]));
  const doc = await (await singleton('loot')).findOne({ _id: LOOT_DOC_ID }, { projection });
  if (!doc || LOOT_RULE_KEYS.some(key => doc[key] === undefined)) throw new HttpError(404, MISSING_LOOT_RULES);
  try {
    return parseLootRules(doc);
  } catch (error) {
    const detail = error instanceof HttpError ? error.message : String(error);
    throw new HttpError(500, `Reglas de botín inválidas en Mongo (${detail}). Ejecuta npm run migrate:loot -- --force`);
  }
}

export async function getLoot() {
  const rules = await readLootRules();
  const catalog = await (await collection('items'))
    .find({}, { projection: { nombre: 1, rareza: 1, coste: 1, _id: 0 } })
    .sort({ order: 1 })
    .toArray();
  return {
    ...rules,
    items: buildLootItems(
      catalog.map(item => ({
        nombre: item.nombre,
        rareza: item.rareza,
        coste: item.coste,
      })),
      rules.wildCard,
    ),
  };
}

/** Cambia solo las reglas; los ítems siguen saliendo del catálogo. */
export async function updateLootRules(patch: LootRulesPatch) {
  const { wildCard, ...tables } = patch;
  const set: Record<string, unknown> = { ...tables, updatedAt: new Date().toISOString() };
  for (const [rarity, prob] of Object.entries(wildCard ?? {})) set[`wildCard.${rarity}`] = prob;
  const result = await (await singleton('loot')).updateOne({ _id: LOOT_DOC_ID }, { $set: set });
  if (result.matchedCount !== 1) throw new HttpError(404, MISSING_LOOT_RULES);
  return getLoot();
}

const MISSING_ROLES = 'No hay tablas de rol en Mongo. Ejecuta npm run migrate:roles';

export async function listRoles() {
  const roles = await (await collection('roles')).find({}, PUBLIC).sort({ order: 1 }).toArray();
  if (roles.length === 0) throw new HttpError(404, MISSING_ROLES);
  return roles;
}

export async function getRole(id: string) {
  return one(await collection('roles'), { id }, `No existe el rol ${id}`);
}

export async function updateRole(id: string, patch: RolePatch) {
  const result = await (await collection('roles')).updateOne(
    { id },
    { $set: { ...patch, updatedAt: new Date().toISOString() } },
  );
  if (result.matchedCount !== 1) throw new HttpError(404, `No existe el rol ${id}`);
  return getRole(id);
}

const EMPTY_SPAWN_TOKENS = {
  basico: 0,
  epico: 0,
  legendario: 0,
  rollBasico: 0,
  rollEpico: 0,
} as const;

/** Probabilidades por defecto de la ruleta de aumentos (%). */
const DEFAULT_AUMENTO_ROLL = { probs: { plata: 70, oro: 25, prismatico: 5 }, cost: 0 };

function normalizeAumentoRoll(raw: unknown): typeof DEFAULT_AUMENTO_ROLL {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const probsSrc = src.probs && typeof src.probs === 'object' ? (src.probs as Record<string, unknown>) : null;
  const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100, Math.floor(v)) : 0);
  const probs = probsSrc
    ? { plata: pct(probsSrc.plata), oro: pct(probsSrc.oro), prismatico: pct(probsSrc.prismatico) }
    : { ...DEFAULT_AUMENTO_ROLL.probs };
  if (probs.plata + probs.oro + probs.prismatico !== 100) Object.assign(probs, DEFAULT_AUMENTO_ROLL.probs);
  const cost = typeof src.cost === 'number' && Number.isFinite(src.cost) && src.cost >= 0 ? Math.floor(src.cost) : 0;
  return { probs, cost };
}

function normalizeSpawnTokens(raw: unknown): Record<keyof typeof EMPTY_SPAWN_TOKENS, number> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return {
    basico: num(src.basico),
    epico: num(src.epico),
    legendario: num(src.legendario),
    rollBasico: num(src.rollBasico),
    rollEpico: num(src.rollEpico),
  };
}

export async function getParty() {
  const doc = await (await singleton('party')).findOne({ _id: 'current' }, { projection: { _id: 0 } });
  if (!doc) throw new HttpError(404, 'No hay grupo. Ejecuta npm run seed');
  return {
    ...doc,
    spawnTokens: normalizeSpawnTokens((doc as { spawnTokens?: unknown }).spawnTokens),
    aumentoRoll: normalizeAumentoRoll((doc as { aumentoRoll?: unknown }).aumentoRoll),
  };
}

export async function updateParty(patch: PartyPatch) {
  const { addGold, addSpawnTokens, spendSpawnToken, ...fields } = patch;
  const updatedAt = new Date().toISOString();
  const col = await singleton('party');

  if (spendSpawnToken) {
    if (Object.keys(fields).length || addGold !== undefined || addSpawnTokens) {
      throw new HttpError(400, 'spendSpawnToken no se combina con otros cambios');
    }
    const tokenPath = `spawnTokens.${spendSpawnToken}`;
    await col.updateOne(
      { _id: 'current', spawnTokens: { $exists: false } },
      { $set: { spawnTokens: { ...EMPTY_SPAWN_TOKENS } } },
    );
    const spent = await col.updateOne(
      { _id: 'current', [tokenPath]: { $gte: 1 } },
      { $inc: { [tokenPath]: -1 }, $set: { updatedAt } },
    );
    if (spent.modifiedCount !== 1) {
      const current = await getParty();
      const have = current.spawnTokens[spendSpawnToken] ?? 0;
      throw new HttpError(400, `No quedan tokens ${spendSpawnToken} (tienes ${have})`);
    }
    return getParty();
  }

  if (addGold !== undefined && addGold < 0) {
    const taken = -addGold;
    const takenResult = await col.updateOne(
      { _id: 'current', gold: { $gte: taken } },
      { $inc: { gold: addGold }, $set: { ...fields, updatedAt } },
    );
    if (takenResult.modifiedCount === 1) {
      if (fields.level !== undefined) await reconcileAbilityRanks(fields.level);
      return getParty();
    }
    const current = await col.findOne({ _id: 'current' }, { projection: { gold: 1 } });
    if (!current) throw new HttpError(404, 'No hay grupo. Ejecuta npm run seed');
    const have = typeof current.gold === 'number' ? current.gold : 0;
    throw new HttpError(400, `Falta oro (tienes ${have.toLocaleString('es-ES')}, quieres quitar ${taken.toLocaleString('es-ES')})`);
  }

  const $inc: Record<string, number> = {};
  if (addGold !== undefined) $inc.gold = addGold;
  if (addSpawnTokens) {
    await col.updateOne(
      { _id: 'current', spawnTokens: { $exists: false } },
      { $set: { spawnTokens: { ...EMPTY_SPAWN_TOKENS } } },
    );
    for (const [kind, amount] of Object.entries(addSpawnTokens)) {
      if (amount === undefined) continue;
      $inc[`spawnTokens.${kind}`] = amount;
    }
  }

  // Evita tokens negativos al restar.
  if (addSpawnTokens) {
    for (const [kind, amount] of Object.entries(addSpawnTokens)) {
      if (amount === undefined || amount >= 0) continue;
      const path = `spawnTokens.${kind}`;
      const taken = -amount;
      const ok = await col.updateOne(
        { _id: 'current', [path]: { $gte: taken } },
        { $inc: { [path]: amount }, $set: { ...fields, updatedAt } },
      );
      if (ok.modifiedCount !== 1) {
        const current = await getParty();
        const have = current.spawnTokens[kind as keyof typeof current.spawnTokens] ?? 0;
        throw new HttpError(400, `No se pueden quitar ${taken} tokens ${kind} (tienes ${have})`);
      }
      delete $inc[path];
    }
  }

  const update: { $set: Record<string, unknown>; $inc?: Record<string, number> } = {
    $set: { ...fields, updatedAt },
  };
  if (Object.keys($inc).length) update.$inc = $inc;
  const result = await col.updateOne({ _id: 'current' }, update);
  if (result.matchedCount === 0) throw new HttpError(404, 'No hay grupo. Ejecuta npm run seed');
  if (fields.level !== undefined) await reconcileAbilityRanks(fields.level);
  return getParty();
}

async function players(): Promise<Collection<PlayerDoc>> {
  return (await getDb()).collection<PlayerDoc>('players');
}

async function partyLevelNow(): Promise<number> {
  const doc = await (await singleton('party')).findOne({ _id: 'current' }, { projection: { level: 1 } });
  return typeof doc?.level === 'number' && doc.level >= 1 ? Math.floor(doc.level) : 1;
}

/** Siempre devuelve rangos y puntos libres coherentes con el nivel actual del grupo. */
function withRanks<T extends Document>(doc: T, level: number): T & { abilityRanks: AbilityRanks; unassignedPoints: number } {
  const ranks = normalizeRanks(doc.abilityRanks, level);
  return { ...doc, abilityRanks: ranks, unassignedPoints: unassignedPoints(ranks, level) };
}

/** Recalcula y guarda rangos/puntos libres de todos los jugadores (al cambiar el nivel del grupo). */
export async function reconcileAbilityRanks(level?: number): Promise<number> {
  const current = level ?? (await partyLevelNow());
  const col = await players();
  const docs = await col.find({}, { projection: { abilityRanks: 1, unassignedPoints: 1 } }).toArray();
  let changed = 0;
  for (const doc of docs) {
    const ranks = normalizeRanks(doc.abilityRanks, current);
    const free = unassignedPoints(ranks, current);
    const same =
      doc.unassignedPoints === free &&
      RANKED_SLOTS.every(slot => doc.abilityRanks?.[slot] === ranks[slot]);
    if (same) continue;
    await col.updateOne({ _id: doc._id }, { $set: { abilityRanks: ranks, unassignedPoints: free } });
    changed++;
  }
  return changed;
}

export async function listPlayers() {
  const [docs, level] = await Promise.all([
    (await players()).find({}, PUBLIC).sort({ order: 1 }).toArray(),
    partyLevelNow(),
  ]);
  return docs.map(doc => withRanks(doc, level));
}

export async function getPlayer(name: string) {
  const doc = await (await players()).findOne({ name }, { ...PUBLIC, collation: CI });
  if (!doc) throw new HttpError(404, `No existe el jugador ${name}`);
  return withRanks(doc, await partyLevelNow());
}

/** Aplica el cambio de rangos paso a paso para dar un error claro (sin puntos, R bloqueada…). */
async function nextAbilityRanks(existing: PlayerDoc, patch: NonNullable<PlayerPatch['abilityRanks']>) {
  const level = await partyLevelNow();
  const ranks = normalizeRanks(existing.abilityRanks, level);
  const lowered = { ...ranks };
  for (const slot of RANKED_SLOTS) {
    const wanted = patch[slot];
    if (wanted !== undefined && wanted < lowered[slot]) lowered[slot] = wanted;
  }
  const next = { ...lowered };
  for (const slot of RANKED_SLOTS) {
    const wanted = patch[slot];
    if (wanted === undefined) continue;
    while (next[slot] < wanted) {
      if (!canRaise(next, slot, level)) {
        if (unassignedPoints(next, level) <= 0) throw new HttpError(400, 'No quedan puntos de habilidad sin asignar');
        if (slot === 'R') {
          throw new HttpError(400, `La definitiva solo sube en los niveles 6, 11 y 16 (a nivel ${level}, máximo ${ultRankCap(level)})`);
        }
        throw new HttpError(400, `${slot} ya está al máximo`);
      }
      next[slot]++;
    }
  }
  return { ranks: next, unassignedPoints: unassignedPoints(next, level) };
}

const CHAMPION_ABILITY_KIND = {
  P: 'pasiva',
  Q: 'basica',
  W: 'basica',
  E: 'basica',
  R: 'definitiva',
} as const;

const PLAYER_SLOT_KIND = {
  P: 'pasiva',
  H1: 'basica',
  H2: 'basica',
  H3: 'basica',
  R: 'definitiva',
} as const;

const SLOT_REFUSAL: Record<keyof typeof PLAYER_SLOT_KIND, string> = {
  P: 'La pasiva solo admite pasivas',
  H1: 'Q, W y E solo admiten habilidades básicas',
  H2: 'Q, W y E solo admiten habilidades básicas',
  H3: 'Q, W y E solo admiten habilidades básicas',
  R: 'La definitiva solo admite definitivas',
};

type ClassifiedAbility = {
  kind: (typeof CHAMPION_ABILITY_KIND)[keyof typeof CHAMPION_ABILITY_KIND] | 'unlearned';
  role: string;
};

/** El primer campeón que usa el nombre decide el tipo y el rol, igual que en el cliente. */
async function assertAbilitiesFit(
  abilities: Partial<Record<string, string | null>> | undefined,
  playerRol?: string,
): Promise<void> {
  if (!abilities) return;
  const filled = Object.entries(abilities).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  if (filled.length === 0) return;

  const docs = await (await collection('champions'))
    .find({}, { projection: { abilities: 1, role: 1, _id: 0 } })
    .sort({ order: 1 })
    .toArray();

  const classified = new Map<string, ClassifiedAbility>();
  for (const doc of docs) {
    const slots = doc.abilities;
    if (!slots || typeof slots !== 'object') continue;
    const role = typeof doc.role === 'string' ? doc.role : '';
    for (const slot of Object.keys(CHAMPION_ABILITY_KIND) as (keyof typeof CHAMPION_ABILITY_KIND)[]) {
      const ability = (slots as Record<string, unknown>)[slot];
      if (!ability || typeof ability !== 'object') continue;
      const record = ability as { name?: unknown; learned?: unknown };
      if (typeof record.name !== 'string' || !record.name.trim()) continue;
      const key = record.name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (classified.has(key)) continue;
      classified.set(key, {
        kind: record.learned === true ? CHAMPION_ABILITY_KIND[slot] : 'unlearned',
        role,
      });
    }
  }

  const wantedRol = playerRol?.trim().toLowerCase() ?? '';
  for (const [slot, name] of filled) {
    const playerSlot = slot as keyof typeof PLAYER_SLOT_KIND;
    const expected = PLAYER_SLOT_KIND[playerSlot];
    if (!expected) continue;
    const found = classified.get(name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (!found) throw new HttpError(400, `No existe la habilidad ${name}`);
    if (found.kind === 'unlearned') throw new HttpError(400, 'Solo se pueden asignar habilidades aprendidas');
    if (found.kind !== expected) throw new HttpError(400, SLOT_REFUSAL[playerSlot]);
    if (wantedRol && found.role.trim().toLowerCase() !== wantedRol) {
      throw new HttpError(400, `${name} no es una habilidad de ${playerRol}`);
    }
  }
}

export async function updatePlayer(name: string, patch: PlayerPatch) {
  const col = await players();
  const existing = await col.findOne({ name }, { collation: CI });
  if (!existing) throw new HttpError(404, `No existe el jugador ${name}`);
  await assertAbilitiesFit(patch.abilities, typeof existing.rol === 'string' ? existing.rol : undefined);

  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const $unset: Record<string, ''> = {};
  if (patch.abilities) $set.abilities = { ...existing.abilities, ...patch.abilities };
  if (patch.equipamiento) $set.equipamiento = patch.equipamiento;
  if (patch.build) $set.build = patch.build;
  if (patch.stats) $set.stats = patch.stats;
  if (patch.hp !== undefined) $set.hp = patch.hp;
  if (patch.actualHp !== undefined) $set.actualHp = patch.actualHp;
  if (patch.escudo !== undefined) $set.escudo = patch.escudo;
  if (patch.vidaTemporal !== undefined) $set.vidaTemporal = patch.vidaTemporal;
  if (patch.mana !== undefined) $set.mana = patch.mana;
  if (patch.actualMana !== undefined) $set.actualMana = patch.actualMana;
  if (patch.inspiration !== undefined) $set.inspiration = patch.inspiration;
  if (patch.accentColor === null) $unset.accentColor = '';
  else if (patch.accentColor) $set.accentColor = patch.accentColor;
  if (patch.shortRestsUsed !== undefined) $set.shortRestsUsed = patch.shortRestsUsed;
  if (patch.unlocks) {
    const current = existing.unlocks && typeof existing.unlocks === 'object' ? existing.unlocks : {};
    // Mongo guarda el objeto entero: así un PATCH parcial no borra los demás desbloqueos.
    $set.unlocks = { ...current, ...patch.unlocks };
  }
  if (patch.quests) $set.quests = patch.quests;
  if (patch.aumentos) $set.aumentos = patch.aumentos;
  if (patch.background === null) $unset.background = '';
  else if (patch.background) $set.background = patch.background;
  if (patch.mechanic === null) $unset.mechanic = '';
  else if (patch.mechanic) $set.mechanic = patch.mechanic;
  if (patch.sheet === null) $unset.sheet = '';
  else if (patch.sheet) $set.sheet = patch.sheet;
  if (patch.basicAttack === null) $unset.basicAttack = '';
  else if (patch.basicAttack) $set.basicAttack = patch.basicAttack;
  if (patch.abilityRanks) {
    const next = await nextAbilityRanks(existing, patch.abilityRanks);
    $set.abilityRanks = next.ranks;
    $set.unassignedPoints = next.unassignedPoints;
  }
  if (patch.stacks) {
    const current = existing.stacks && typeof existing.stacks === 'object' && !Array.isArray(existing.stacks)
      ? existing.stacks as Record<string, number>
      : {};
    $set.stacks = { ...current, ...patch.stacks };
  }
  if (patch.cooldowns) {
    const current = existing.cooldowns && typeof existing.cooldowns === 'object' && !Array.isArray(existing.cooldowns)
      ? existing.cooldowns as Record<string, number>
      : {};
    $set.cooldowns = { ...current, ...patch.cooldowns };
  }
  if (patch.activeEffects) {
    const current = existing.activeEffects && typeof existing.activeEffects === 'object' && !Array.isArray(existing.activeEffects)
      ? existing.activeEffects as Record<string, number>
      : {};
    $set.activeEffects = { ...current, ...patch.activeEffects };
  }

  await col.updateOne(
    { _id: existing._id },
    Object.keys($unset).length ? { $set, $unset } : { $set },
  );
  return getPlayer(existing.name);
}

export async function upsertPlayer(name: string, input: PlayerReplace) {
  const col = await players();
  const trimmed = name.trim();
  if (!trimmed) throw new HttpError(400, 'Falta el nombre del jugador');
  const existing = await col.findOne({ name: trimmed }, { collation: CI });
  const storedName = existing?.name ?? trimmed;
  const order = existing?.order ?? (await col.countDocuments());
  await assertAbilitiesFit(input.abilities, typeof existing?.rol === 'string' ? existing.rol : undefined);

  await col.updateOne(
    { name: storedName },
    { $set: { ...input, name: storedName, order, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
  return getPlayer(storedName);
}

type IngredientLine = { nombre: string; cantidad: number };

type HistoryEntry = {
  id: string;
  kind: HistoryKind;
  timestamp: string;
  item: string;
  reverted: boolean;
  tirada?: string;
  rareza?: string;
  ingredients?: IngredientLine[];
  cantidad?: number;
  oro?: number;
};

function historyMoment(doc: Document): number {
  if (doc.createdAt instanceof Date) return doc.createdAt.getTime();
  if (typeof doc.timestamp !== 'string') return 0;
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(doc.timestamp);
  if (!match) return 0;
  const [, day, month, year, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function ingredientLines(value: unknown): IngredientLine[] {
  if (!Array.isArray(value)) return [];
  const lines: IngredientLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.nombre !== 'string' || !source.nombre.trim()) continue;
    if (typeof source.cantidad !== 'number' || !Number.isFinite(source.cantidad) || source.cantidad < 1) continue;
    lines.push({ nombre: source.nombre.trim(), cantidad: source.cantidad });
  }
  return lines;
}

function toHistoryEntry(doc: Document, kind: HistoryKind): HistoryEntry {
  const entry: HistoryEntry = {
    id: String(doc._id),
    kind,
    timestamp: typeof doc.timestamp === 'string' ? doc.timestamp : '',
    item: typeof doc.item === 'string' ? doc.item : '',
    reverted: doc.reverted === true,
  };
  if (kind === 'tirada') {
    entry.tirada = typeof doc.tirada === 'string' ? doc.tirada : '';
    entry.rareza = typeof doc.rareza === 'string' ? doc.rareza : '';
  } else if (kind === 'crafteo') {
    entry.ingredients = ingredientLines(doc.ingredients);
    if (typeof doc.oro === 'number' && Number.isFinite(doc.oro) && doc.oro >= 0) entry.oro = doc.oro;
  } else {
    if (typeof doc.cantidad === 'number' && Number.isInteger(doc.cantidad) && doc.cantidad > 0) entry.cantidad = doc.cantidad;
    if (typeof doc.oro === 'number' && Number.isFinite(doc.oro) && doc.oro >= 0) entry.oro = doc.oro;
  }
  return entry;
}

function historyCollectionName(kind: HistoryKind): string {
  if (kind === 'tirada') return 'rollHistoric';
  if (kind === 'crafteo') return 'craftHistoric';
  if (kind === 'compra') return 'buyHistoric';
  return 'sellHistoric';
}

function paidGold(doc: Document): number {
  return typeof doc.oro === 'number' && Number.isFinite(doc.oro) && doc.oro > 0 ? doc.oro : 0;
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const [rolls, crafts, buys, sells] = await Promise.all([
    (await collection('rollHistoric')).find({}).toArray(),
    (await collection('craftHistoric')).find({}).toArray(),
    (await collection('buyHistoric')).find({}).toArray(),
    (await collection('sellHistoric')).find({}).toArray(),
  ]);
  return [
    ...rolls.map(doc => ({ doc, kind: 'tirada' as const })),
    ...crafts.map(doc => ({ doc, kind: 'crafteo' as const })),
    ...buys.map(doc => ({ doc, kind: 'compra' as const })),
    ...sells.map(doc => ({ doc, kind: 'venta' as const })),
  ]
    .sort((a, b) => historyMoment(b.doc) - historyMoment(a.doc))
    .map(({ doc, kind }) => toHistoryEntry(doc, kind));
}

function historyObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'No existe esa entrada del historial');
  return new ObjectId(id);
}

function copyCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99) {
    throw new HttpError(400, 'La entrada del historial está mal formada');
  }
  return value;
}

/** Una compra no se deshace si esas copias se craftearon o se vendieron después. */
async function purchaseStillHeld(item: string, after: number): Promise<void> {
  const key = itemKey(item);
  const hits: { at: number; message: string }[] = [];

  for (const craft of await (await collection('craftHistoric')).find({}).toArray()) {
    const at = historyMoment(craft);
    if (at <= after) continue;
    const used = ingredientLines(craft.ingredients).some(line => itemKey(line.nombre) === key);
    if (!used) continue;
    const result = typeof craft.item === 'string' && craft.item.trim() ? craft.item.trim() : 'otro objeto';
    hits.push({
      at,
      message: `No se puede revertir la compra de ${item}: se usó para craftear ${result}. Revierte primero ese crafteo.`,
    });
  }

  for (const sale of await (await collection('sellHistoric')).find({}).toArray()) {
    const at = historyMoment(sale);
    if (at <= after) continue;
    if (typeof sale.item !== 'string' || itemKey(sale.item) !== key) continue;
    hits.push({
      at,
      message: `No se puede revertir la compra de ${item}: después se vendió. Revierte primero esa venta.`,
    });
  }

  hits.sort((a, b) => a.at - b.at);
  if (hits[0]) throw new HttpError(409, hits[0].message);
}

/** Quita copias libres. Lo equipado no se puede deshacer hasta que se suelte. */
async function takeFreeCopies(nombre: string, amount: number) {
  const col = await collection('items');
  const existing = await col.findOne({ nombre }, { collation: CI });
  if (!existing || typeof existing.nombre !== 'string') throw new HttpError(404, `No existe el item ${nombre}`);
  const reserved = (await equippedCounts()).get(itemKey(existing.nombre)) ?? 0;
  const result = await col.updateOne(
    { _id: existing._id, cantidad: { $gte: reserved + amount } },
    { $inc: { cantidad: -amount }, $set: { updatedAt: new Date().toISOString() } },
  );
  if (result.modifiedCount !== 1) {
    const free = Math.max(0, countOf(existing.cantidad) - reserved);
    if (amount === 1 && free < 1 && countOf(existing.cantidad) > 0) {
      throw new HttpError(409, `No se puede revertir: ${existing.nombre} está equipado`);
    }
    if (amount === 1) throw new HttpError(409, `No se puede revertir: no queda una copia libre de ${existing.nombre}`);
    if (reserved > 0 && free < amount) {
      throw new HttpError(409, `No se puede revertir: las copias equipadas de ${existing.nombre} no se quitan`);
    }
    throw new HttpError(409, `No se puede revertir: no quedan ${amount} copias libres de ${existing.nombre}`);
  }
  return existing.nombre;
}

async function giveCopies(nombre: string, amount: number) {
  const col = await collection('items');
  const result = await col.updateOne(
    { nombre },
    { $inc: { cantidad: amount }, $set: { updatedAt: new Date().toISOString() } },
    { collation: CI },
  );
  if (result.matchedCount !== 1) throw new HttpError(404, `No existe el item ${nombre}`);
}

async function changedItems(names: string[]) {
  const unique = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  return (await collection('items')).find({ nombre: { $in: unique } }, { ...PUBLIC, collation: CI }).toArray();
}

async function deleteHistory(col: Collection, existing: Document, undo: () => Promise<void>) {
  const deleted = await col.deleteOne({ _id: existing._id, reverted: { $ne: true } });
  if (deleted.deletedCount === 1) return;
  try {
    await undo();
  } catch (rollbackError) {
    logError(rollbackError);
  }
  throw new HttpError(409, 'Esa entrada ya está revertida');
}

/** Deshace la operación y borra la entrada del historial. */
export async function revertHistory(kind: HistoryKind, id: string) {
  const col = await collection(historyCollectionName(kind));
  const existing = await col.findOne({ _id: historyObjectId(id) });
  if (!existing) throw new HttpError(404, 'No existe esa entrada del historial');
  if (existing.reverted === true) throw new HttpError(409, 'Esa entrada ya está revertida');
  if (typeof existing.item !== 'string' || !existing.item.trim()) {
    throw new HttpError(400, 'La entrada del historial está mal formada');
  }

  if (kind === 'compra' || kind === 'venta') {
    const item = existing.item.trim();
    const amount = copyCount(existing.cantidad);
    const gold = paidGold(existing);
    if (kind === 'compra') await purchaseStillHeld(item, historyMoment(existing));

    let stockChanged = false;
    let goldChanged = false;
    const undo = async () => {
      if (kind === 'compra') {
        if (stockChanged) await giveCopies(item, amount);
        if (goldChanged) await chargeGold(gold, new Date().toISOString());
      } else {
        if (stockChanged) await takeFreeCopies(item, amount);
        if (goldChanged) await refundGold(gold);
      }
    };
    try {
      if (kind === 'compra') {
        await takeFreeCopies(item, amount);
        stockChanged = true;
        if (gold > 0) {
          await refundGold(gold);
          goldChanged = true;
        }
      } else {
        if (gold > 0) {
          await chargeGold(gold, new Date().toISOString());
          goldChanged = true;
        }
        await giveCopies(item, amount);
        stockChanged = true;
      }
    } catch (error) {
      try {
        await undo();
      } catch (rollbackError) {
        logError(rollbackError);
      }
      throw error;
    }
    await deleteHistory(col, existing, undo);
    return {
      id: String(existing._id),
      kind,
      items: await changedItems([item]),
      gold: await readPartyGold(),
    };
  }

  const touched = [existing.item];
  const given: IngredientLine[] = [];
  const refund = kind === 'crafteo' ? paidGold(existing) : 0;
  let removed = false;
  let refunded = false;
  const undo = async () => {
    for (const line of [...given].reverse()) await giveCopies(line.nombre, -line.cantidad);
    if (removed) await giveCopies(existing.item, 1);
    if (refunded) await chargeGold(refund, new Date().toISOString());
  };
  try {
    await takeFreeCopies(existing.item, 1);
    removed = true;
    if (kind === 'crafteo') {
      for (const line of ingredientLines(existing.ingredients)) {
        await giveCopies(line.nombre, line.cantidad);
        given.push(line);
        touched.push(line.nombre);
      }
      if (refund > 0) {
        await refundGold(refund);
        refunded = true;
      }
    }
  } catch (error) {
    try {
      await undo();
    } catch (rollbackError) {
      logError(rollbackError);
    }
    throw error;
  }

  await deleteHistory(col, existing, undo);

  return {
    id: String(existing._id),
    kind,
    items: await changedItems(touched),
    gold: await readPartyGold(),
  };
}

export type TicketEntry = {
  id: string;
  title: string;
  text: string;
  author?: string;
  /** Docs viejos sin estado se leen como 'pending'. */
  status: TicketStatus;
  createdAt: string;
};

function toTicket(doc: Document): TicketEntry {
  const created = doc.createdAt instanceof Date
    ? doc.createdAt
    : doc._id instanceof ObjectId
      ? doc._id.getTimestamp()
      : new Date(0);
  const entry: TicketEntry = {
    id: String(doc._id),
    title: typeof doc.title === 'string' ? doc.title : '',
    text: typeof doc.text === 'string' ? doc.text : '',
    status: doc.status === 'accepted' || doc.status === 'rejected' || doc.status === 'completed' ? doc.status : 'pending',
    createdAt: created.toISOString(),
  };
  if (typeof doc.author === 'string' && doc.author.trim()) entry.author = doc.author.trim();
  return entry;
}

/** Sugerencias, de la más nueva a la más vieja. */
export async function listTickets(): Promise<TicketEntry[]> {
  const docs = await (await collection('tickets')).find({}).sort({ createdAt: -1, _id: -1 }).toArray();
  return docs.map(toTicket);
}

export async function createTicket(input: TicketInput): Promise<TicketEntry> {
  const doc: Document = { title: input.title, text: input.text, status: 'pending', createdAt: new Date() };
  if (input.author) doc.author = input.author;
  const result = await (await collection('tickets')).insertOne(doc);
  return toTicket({ ...doc, _id: result.insertedId });
}

/** Aceptar / rechazar / completar / volver a pendiente (solo admin, lo comprueba la API). */
export async function updateTicketStatus(id: string, status: TicketStatus): Promise<TicketEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'No existe esa sugerencia');
  const tickets = await collection('tickets');
  const _id = new ObjectId(id);
  const result = await tickets.updateOne({ _id }, { $set: { status, statusAt: new Date() } });
  if (result.matchedCount === 0) throw new HttpError(404, 'No existe esa sugerencia');
  const doc = await tickets.findOne({ _id });
  if (!doc) throw new HttpError(404, 'No existe esa sugerencia');
  return toTicket(doc);
}

export async function deleteTicket(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'No existe esa sugerencia');
  const result = await (await collection('tickets')).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, 'No existe esa sugerencia');
  return { id };
}

export type AugmentEntry = {
  id: string;
  rarity: 'plata' | 'oro' | 'prismatico';
  name: string;
  description: string;
  /** Efectos de nivel 1, 2 y 3 (solo aumentos con niveles; 1-3 textos, puede haber vacíos en medio). */
  levels?: string[];
  createdAt: string;
};

function toAugment(doc: Document): AugmentEntry {
  const created = doc.createdAt instanceof Date
    ? doc.createdAt
    : doc._id instanceof ObjectId
      ? doc._id.getTimestamp()
      : new Date(0);
  const entry: AugmentEntry = {
    id: String(doc._id),
    rarity: doc.rarity === 'oro' || doc.rarity === 'prismatico' ? doc.rarity : 'plata',
    name: typeof doc.name === 'string' ? doc.name : '',
    description: typeof doc.description === 'string' ? doc.description : '',
    createdAt: created.toISOString(),
  };
  if (Array.isArray(doc.levels) && doc.levels.length >= 1 && doc.levels.length <= 3 && doc.levels.every((t: unknown) => typeof t === 'string')) {
    entry.levels = doc.levels as string[];
  }
  return entry;
}

const MISSING_AUGMENT = 'No existe ese aumento';

/** Catálogo de aumentos (colección augments), por nombre. */
export async function listAugments(): Promise<AugmentEntry[]> {
  const docs = await (await collection('augments')).find({}).sort({ name: 1, _id: 1 }).collation(CI).toArray();
  return docs.map(toAugment);
}

export async function createAugment(input: AugmentInput): Promise<AugmentEntry> {
  const { levels, ...rest } = input;
  const doc: Document = { ...rest, createdAt: new Date() };
  if (levels) doc.levels = levels;
  const result = await (await collection('augments')).insertOne(doc);
  return toAugment({ ...doc, _id: result.insertedId });
}

export async function updateAugment(id: string, patch: Partial<AugmentInput>): Promise<AugmentEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_AUGMENT);
  const col = await collection('augments');
  const _id = new ObjectId(id);
  // price era del formato antiguo (precio por aumento): se limpia al editar.
  // levels: null quita los niveles (vuelve a un solo efecto).
  const { levels, ...rest } = patch;
  const $set: Document = { ...rest, updatedAt: new Date() };
  const $unset: Document = { price: '' };
  if (levels) $set.levels = levels;
  else if (levels === null) $unset.levels = '';
  const result = await col.updateOne({ _id }, { $set, $unset });
  if (result.matchedCount === 0) throw new HttpError(404, MISSING_AUGMENT);
  const doc = await col.findOne({ _id });
  if (!doc) throw new HttpError(404, MISSING_AUGMENT);
  return toAugment(doc);
}

export async function deleteAugment(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_AUGMENT);
  const result = await (await collection('augments')).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING_AUGMENT);
  return { id };
}

export async function mongoStatus() {
  const db = await getDb();
  await db.command({ ping: 1 });
  const names = ['champions', 'items', 'players', 'roles', 'loot', 'party', 'rollHistoric', 'craftHistoric', 'buyHistoric', 'sellHistoric', 'tickets', 'augments', 'mapPois', 'faq', 'npcs', 'relations', 'events'] as const;
  const counts = Object.fromEntries(
    await Promise.all(names.map(async name => [name, await db.collection(name).estimatedDocumentCount()] as const)),
  );
  return {
    ok: true as const,
    db: db.databaseName,
    writes: process.env.API_WRITE_KEY?.trim() ? 'protegidas' as const : 'abiertas' as const,
    counts,
  };
}

// ── Puntos de interés propios del mapa ──

export type MapPoiEntry = {
  id: string;
  kind: MapPoiKind;
  name: string;
  note?: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt?: string;
};

const MISSING_MAP_POI = 'No existe ese punto del mapa';

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : undefined;
}

function toMapPoi(doc: Document): MapPoiEntry {
  const entry: MapPoiEntry = {
    id: String(doc._id),
    kind: doc.kind === 'party' ? 'party' : 'poi',
    name: typeof doc.name === 'string' ? doc.name : '',
    x: typeof doc.x === 'number' ? doc.x : 0,
    y: typeof doc.y === 'number' ? doc.y : 0,
    createdAt: isoDate(doc.createdAt) ?? '',
  };
  if (typeof doc.note === 'string' && doc.note) entry.note = doc.note;
  const updatedAt = isoDate(doc.updatedAt);
  if (updatedAt) entry.updatedAt = updatedAt;
  return entry;
}

async function mapPois(): Promise<Collection> {
  return collection('mapPois');
}

export async function listMapPois(): Promise<MapPoiEntry[]> {
  const docs = await (await mapPois()).find({}).sort({ createdAt: 1 }).toArray();
  // La party primero; si por lo que sea hubiera varias, solo cuenta la más reciente.
  const entries = docs.map(toMapPoi);
  const parties = entries.filter(entry => entry.kind === 'party');
  const party = parties.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))[0];
  return [...(party ? [party] : []), ...entries.filter(entry => entry.kind !== 'party')];
}

/**
 * Crea un punto. La ubicación de la party es única: si ya existe, se mueve
 * (y se actualizan nombre y nota) en vez de crear otra.
 */
export async function createMapPoi(input: MapPoiInput): Promise<{ poi: MapPoiEntry; replaced: boolean }> {
  const col = await mapPois();
  const now = new Date();
  if (input.kind === 'party') {
    const existing = await col.find({ kind: 'party' }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
    const keep = existing[0];
    if (keep) {
      const $set: Document = { name: input.name, x: input.x, y: input.y, updatedAt: now };
      const update: Document = { $set };
      if (input.note) $set.note = input.note;
      else update.$unset = { note: '' };
      await col.updateOne({ _id: keep._id }, update);
      // Limpia duplicados antiguos (no debería haber).
      if (existing.length > 1) await col.deleteMany({ kind: 'party', _id: { $ne: keep._id } });
      const doc = await col.findOne({ _id: keep._id });
      if (!doc) throw new HttpError(404, MISSING_MAP_POI);
      return { poi: toMapPoi(doc), replaced: true };
    }
  }
  const doc: Document = { ...input, createdAt: now };
  const result = await col.insertOne(doc);
  return { poi: toMapPoi({ ...doc, _id: result.insertedId }), replaced: false };
}

export async function updateMapPoi(id: string, patch: MapPoiPatch): Promise<MapPoiEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_MAP_POI);
  const col = await mapPois();
  const _id = new ObjectId(id);
  const { note, ...rest } = patch;
  const $set: Document = { ...rest, updatedAt: new Date() };
  const update: Document = { $set };
  if (note) $set.note = note;
  else if (note === null) update.$unset = { note: '' };
  const result = await col.updateOne({ _id }, update);
  if (result.matchedCount === 0) throw new HttpError(404, MISSING_MAP_POI);
  const doc = await col.findOne({ _id });
  if (!doc) throw new HttpError(404, MISSING_MAP_POI);
  return toMapPoi(doc);
}

export async function deleteMapPoi(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_MAP_POI);
  const result = await (await mapPois()).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING_MAP_POI);
  return { id };
}

// ── Mecánicas (FAQ) ──

export type FaqEntry = {
  id: string;
  title: string;
  body: string;
  category?: string;
  order: number;
  createdAt: string;
  updatedAt?: string;
};

const MISSING_FAQ = 'No existe esa entrada de Mecánicas';
const FAQ_ORDER_STEP = 10;

function toFaq(doc: Document): FaqEntry {
  const entry: FaqEntry = {
    id: String(doc._id),
    title: typeof doc.title === 'string' ? doc.title : '',
    body: typeof doc.body === 'string' ? doc.body : '',
    order: typeof doc.order === 'number' ? doc.order : 0,
    createdAt: isoDate(doc.createdAt) ?? '',
  };
  if (typeof doc.category === 'string' && doc.category) entry.category = doc.category;
  const updatedAt = isoDate(doc.updatedAt);
  if (updatedAt) entry.updatedAt = updatedAt;
  return entry;
}

let faqSeeded: Promise<void> | undefined;

/** Siembra las entradas iniciales solo si la colección no existe (si el admin las borra todas, no vuelven). */
async function faqCollection(): Promise<Collection> {
  const db = await getDb();
  faqSeeded ??= (async () => {
    const exists = await db.listCollections({ name: 'faq' }, { nameOnly: true }).hasNext();
    if (exists) return;
    const now = new Date();
    const docs = FAQ_SEED.map((seed, index) => {
      const doc: Document = {
        _id: new ObjectId(seed.id),
        title: seed.title,
        body: seed.body,
        order: (index + 1) * FAQ_ORDER_STEP,
        createdAt: now,
      };
      if (seed.category) doc.category = seed.category;
      return doc;
    });
    try {
      await db.collection('faq').insertMany(docs, { ordered: false });
    } catch (error) {
      // Otra petición sembró a la vez (ids fijos → clave duplicada): no pasa nada.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  })().catch(error => {
    faqSeeded = undefined;
    throw error;
  });
  await faqSeeded;
  return db.collection('faq');
}

export async function listFaq(): Promise<FaqEntry[]> {
  const docs = await (await faqCollection()).find({}).sort({ order: 1, createdAt: 1, _id: 1 }).toArray();
  return docs.map(toFaq);
}

/** Sin orden: va al final. */
export async function createFaq(input: FaqInput): Promise<FaqEntry> {
  const col = await faqCollection();
  let order = input.order;
  if (order === undefined) {
    const last = await col.find({}).sort({ order: -1 }).limit(1).toArray();
    const top = typeof last[0]?.order === 'number' ? last[0].order : 0;
    order = top + FAQ_ORDER_STEP;
  }
  const doc: Document = { title: input.title, body: input.body, order, createdAt: new Date() };
  if (input.category) doc.category = input.category;
  const result = await col.insertOne(doc);
  return toFaq({ ...doc, _id: result.insertedId });
}

export async function updateFaq(id: string, patch: FaqPatch): Promise<FaqEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_FAQ);
  const col = await faqCollection();
  const _id = new ObjectId(id);
  const { category, ...rest } = patch;
  const $set: Document = { ...rest, updatedAt: new Date() };
  const update: Document = { $set };
  if (category) $set.category = category;
  else if (category === null) update.$unset = { category: '' };
  const result = await col.updateOne({ _id }, update);
  if (result.matchedCount === 0) throw new HttpError(404, MISSING_FAQ);
  const doc = await col.findOne({ _id });
  if (!doc) throw new HttpError(404, MISSING_FAQ);
  return toFaq(doc);
}

export async function deleteFaq(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_FAQ);
  const result = await (await faqCollection()).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING_FAQ);
  return { id };
}

// ── NPCs / Monstruos (colección npcs) ──

export type NpcEntry = NpcInput & { id: string; createdAt: string; updatedAt?: string };

const MISSING_NPC = 'No existe ese NPC';

function toNpcFrame(value: unknown): NpcInput['imageFrame'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, zoom } = value as Record<string, unknown>;
  const num = (raw: unknown, fallback: number) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback);
  return { x: num(x, 50), y: num(y, 50), zoom: num(zoom, 1) };
}

function toNpc(doc: Document): NpcEntry {
  const created = doc.createdAt instanceof Date
    ? doc.createdAt
    : doc._id instanceof ObjectId
      ? doc._id.getTimestamp()
      : new Date(0);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const entry: NpcEntry = {
    id: String(doc._id),
    name: text(doc.name),
    kind: doc.kind === 'monstruo' ? 'monstruo' : 'npc',
    type: text(doc.type),
    region: text(doc.region),
    level: typeof doc.level === 'number' && Number.isFinite(doc.level) ? doc.level : 1,
    image: text(doc.image),
    imageFrame: toNpcFrame(doc.imageFrame),
    // Sin imageFrameCircle (NPCs antiguos) = foto vinculada.
    imageFrameCircle: toNpcFrame(doc.imageFrameCircle),
    background: typeof doc.background === 'string' && doc.background ? doc.background : null,
    description: text(doc.description),
    publicNotes: text(doc.publicNotes),
    stats: doc.stats && typeof doc.stats === 'object' && !Array.isArray(doc.stats) ? doc.stats as NpcInput['stats'] : {},
    abilities: Array.isArray(doc.abilities) ? doc.abilities as NpcInput['abilities'] : [],
    visible: doc.visible === true,
    createdAt: created.toISOString(),
  };
  if (doc.updatedAt instanceof Date) entry.updatedAt = doc.updatedAt.toISOString();
  return entry;
}

/** Todos los NPCs/monstruos por nombre. */
export async function listNpcs(): Promise<NpcEntry[]> {
  const docs = await (await collection('npcs')).find({}).sort({ name: 1, _id: 1 }).collation(CI).toArray();
  return docs.map(toNpc);
}

export async function getNpc(id: string): Promise<NpcEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_NPC);
  const doc = await (await collection('npcs')).findOne({ _id: new ObjectId(id) });
  if (!doc) throw new HttpError(404, MISSING_NPC);
  return toNpc(doc);
}

export async function createNpc(input: NpcInput): Promise<NpcEntry> {
  const doc: Document = { ...input, createdAt: new Date() };
  const result = await (await collection('npcs')).insertOne(doc);
  return toNpc({ ...doc, _id: result.insertedId });
}

export async function updateNpc(id: string, patch: Partial<NpcInput>): Promise<NpcEntry> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_NPC);
  const col = await collection('npcs');
  const _id = new ObjectId(id);
  const result = await col.updateOne({ _id }, { $set: { ...patch, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new HttpError(404, MISSING_NPC);
  return getNpc(id);
}

export async function deleteNpc(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_NPC);
  const result = await (await collection('npcs')).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING_NPC);
  // Sus relaciones dejan de tener sentido.
  await (await collection('relations')).deleteMany(relationFilter({ kind: 'npc', id }));
  await deleteNotesFor('npc', id);
  return { id };
}

// ── Relaciones entre campeones y NPCs (colección relations) ──
// Un documento por pareja { a, b, note, visibleToPlayers }: es simétrica, así que se ve desde las dos fichas.
// visibleToPlayers (por relación, por defecto false): solo entonces la ven los players.
// Campeón = su nombre (campo champion); NPC = el _id en texto.

export type RelationEntity = {
  kind: RelationRef['kind'];
  id: string;
  name: string;
  image: string;
  /** Encuadre de la foto (solo NPCs): el de la tarjeta (círculo). */
  imageFrame: NpcInput['imageFrame'];
  /** Activo (campeón) / visible (NPC) para los players. */
  visible: boolean;
};

export type RelationView = {
  id: string;
  note: string;
  /** El admin la ha hecho visible para los players. */
  visibleToPlayers: boolean;
  /** La otra punta de la relación (respecto a la ficha consultada). */
  other: RelationEntity;
  createdAt: string;
};

const MISSING_RELATION = 'No existe esa relación';

function relationFilter(ref: RelationRef): Filter<Document> {
  return { $or: [{ 'a.kind': ref.kind, 'a.id': ref.id }, { 'b.kind': ref.kind, 'b.id': ref.id }] };
}

const sameRef = (left: RelationRef, right: RelationRef) =>
  left.kind === right.kind && (left.kind === 'champion' ? left.id.toLowerCase() === right.id.toLowerCase() : left.id === right.id);

/** Resuelve campeones y NPCs de golpe. Clave: kind:id (campeón en minúsculas). */
async function loadRelationEntities(refs: RelationRef[]): Promise<Map<string, RelationEntity>> {
  const out = new Map<string, RelationEntity>();
  const championNames = [...new Set(refs.filter(r => r.kind === 'champion').map(r => r.id))];
  const npcIds = [...new Set(refs.filter(r => r.kind === 'npc' && ObjectId.isValid(r.id)).map(r => r.id))];
  if (championNames.length) {
    const docs = await (await collection('champions'))
      .find({ champion: { $in: championNames } }, { projection: { champion: 1, image: 1, active: 1 }, collation: CI })
      .toArray();
    for (const doc of docs) {
      const name = String(doc.champion);
      out.set(`champion:${name.toLowerCase()}`, {
        kind: 'champion',
        id: name,
        name,
        image: typeof doc.image === 'string' ? doc.image : '',
        imageFrame: null,
        visible: doc.active === true,
      });
    }
  }
  if (npcIds.length) {
    const docs = await (await collection('npcs'))
      .find({ _id: { $in: npcIds.map(id => new ObjectId(id)) } }, { projection: { name: 1, image: 1, imageFrame: 1, imageFrameCircle: 1, visible: 1 } })
      .toArray();
    for (const doc of docs) {
      const id = String(doc._id);
      out.set(`npc:${id}`, {
        kind: 'npc',
        id,
        name: typeof doc.name === 'string' ? doc.name : '',
        image: typeof doc.image === 'string' ? doc.image : '',
        imageFrame: toNpcFrame(doc.imageFrameCircle) ?? toNpcFrame(doc.imageFrame),
        visible: doc.visible === true,
      });
    }
  }
  return out;
}

const entityKey = (ref: RelationRef) => `${ref.kind}:${ref.kind === 'champion' ? ref.id.toLowerCase() : ref.id}`;

async function requireEntity(ref: RelationRef): Promise<RelationEntity> {
  const found = (await loadRelationEntities([ref])).get(entityKey(ref));
  if (!found) throw new HttpError(404, ref.kind === 'champion' ? `No existe el campeón ${ref.id}` : MISSING_NPC);
  return found;
}

function toRelationRef(value: unknown): RelationRef | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, id } = value as Record<string, unknown>;
  if ((kind !== 'champion' && kind !== 'npc') || typeof id !== 'string') return null;
  return { kind, id };
}

/**
 * Relaciones de una ficha (campeón o NPC), con la otra punta resuelta.
 * onlyVisible (players): la ficha tiene que ser visible y solo salen relaciones marcadas visibleToPlayers
 * cuya otra punta también es visible.
 */
export async function listRelationsFor(ref: RelationRef, onlyVisible: boolean): Promise<RelationView[]> {
  const self = await requireEntity(ref);
  if (onlyVisible && !self.visible) throw new HttpError(404, ref.kind === 'champion' ? `No existe el campeón ${ref.id}` : MISSING_NPC);
  const canonical: RelationRef = { kind: ref.kind, id: self.id };
  const docs = await (await collection('relations')).find(relationFilter(canonical), { collation: CI }).sort({ createdAt: 1, _id: 1 }).toArray();
  const pairs = docs.flatMap(doc => {
    const a = toRelationRef(doc.a);
    const b = toRelationRef(doc.b);
    if (!a || !b) return [];
    const other = sameRef(a, canonical) ? b : a;
    return [{ doc, other }];
  });
  const entities = await loadRelationEntities(pairs.map(pair => pair.other));
  const views: RelationView[] = [];
  for (const { doc, other } of pairs) {
    const entity = entities.get(entityKey(other));
    if (!entity) continue; // La otra punta ya no existe.
    const visibleToPlayers = doc.visibleToPlayers === true;
    if (onlyVisible && (!entity.visible || !visibleToPlayers)) continue;
    const created = doc.createdAt instanceof Date ? doc.createdAt : doc._id instanceof ObjectId ? doc._id.getTimestamp() : new Date(0);
    views.push({ id: String(doc._id), note: typeof doc.note === 'string' ? doc.note : '', visibleToPlayers, other: entity, createdAt: created.toISOString() });
  }
  return views.sort((x, y) => x.other.kind.localeCompare(y.other.kind) || x.other.name.localeCompare(y.other.name, 'es', { sensitivity: 'base' }));
}

/** Crea la relación (si ya existe en cualquier sentido, actualiza la nota). Devuelve la vista desde a. */
export async function createRelation(input: RelationInput): Promise<RelationView> {
  if (sameRef(input.a, input.b)) throw new HttpError(400, 'No se puede relacionar una ficha consigo misma');
  const [a, b] = await Promise.all([requireEntity(input.a), requireEntity(input.b)]);
  const refA: RelationRef = { kind: a.kind, id: a.id };
  const refB: RelationRef = { kind: b.kind, id: b.id };
  const col = await collection('relations');
  const existing = await col.findOne({
    $or: [
      { 'a.kind': refA.kind, 'a.id': refA.id, 'b.kind': refB.kind, 'b.id': refB.id },
      { 'a.kind': refB.kind, 'a.id': refB.id, 'b.kind': refA.kind, 'b.id': refA.id },
    ],
  }, { collation: CI });
  const now = new Date();
  if (existing) {
    const $set: Record<string, unknown> = { note: input.note, updatedAt: now };
    if (input.visibleToPlayers !== undefined) $set.visibleToPlayers = input.visibleToPlayers;
    await col.updateOne({ _id: existing._id }, { $set });
    const visibleToPlayers = input.visibleToPlayers ?? existing.visibleToPlayers === true;
    return { id: String(existing._id), note: input.note, visibleToPlayers, other: b, createdAt: (existing.createdAt instanceof Date ? existing.createdAt : now).toISOString() };
  }
  const visibleToPlayers = input.visibleToPlayers === true;
  const result = await col.insertOne({ a: refA, b: refB, note: input.note, visibleToPlayers, createdAt: now });
  return { id: String(result.insertedId), note: input.note, visibleToPlayers, other: b, createdAt: now.toISOString() };
}

/** Cambia la nota y/o la visibilidad para players de una relación. */
export async function updateRelation(id: string, patch: RelationPatch): Promise<{ id: string; note: string; visibleToPlayers: boolean }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_RELATION);
  const doc = await (await collection('relations')).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doc) throw new HttpError(404, MISSING_RELATION);
  return { id, note: typeof doc.note === 'string' ? doc.note : '', visibleToPlayers: doc.visibleToPlayers === true };
}

export async function deleteRelation(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING_RELATION);
  const result = await (await collection('relations')).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING_RELATION);
  return { id };
}

// ── Combate (tracker singleton) ──

const COMBAT_DOC_ID = 'active';

const EMPTY_COMBAT: CombatState = {
  active: false,
  round: 1,
  turnIndex: 0,
  participants: [],
};

function toCombat(doc: Document | null): CombatState & { updatedAt?: string } {
  if (!doc) return { ...EMPTY_COMBAT };
  const participants = Array.isArray(doc.participants) ? doc.participants : [];
  return {
    active: doc.active === true,
    round: typeof doc.round === 'number' && doc.round >= 1 ? Math.trunc(doc.round) : 1,
    turnIndex: typeof doc.turnIndex === 'number' && doc.turnIndex >= 0 ? Math.trunc(doc.turnIndex) : 0,
    participants: participants as CombatState['participants'],
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined,
  };
}

export async function getCombat(): Promise<CombatState & { updatedAt?: string }> {
  const doc = await (await singleton('combat')).findOne({ _id: COMBAT_DOC_ID });
  return toCombat(doc);
}

export async function replaceCombat(state: CombatState): Promise<CombatState & { updatedAt?: string }> {
  const updatedAt = new Date().toISOString();
  await (await singleton('combat')).updateOne(
    { _id: COMBAT_DOC_ID },
    {
      $set: {
        active: state.active,
        round: state.round,
        turnIndex: state.turnIndex,
        participants: state.participants,
        updatedAt,
      },
    },
    { upsert: true },
  );
  return { ...state, updatedAt };
}

/**
 * Termina el combate: vacía el tracker (Preparación) y limpia cooldowns/activeEffects
 * de los players que participaban. No toca stacks ni PG.
 */
export async function endCombatAndResetTrackers(): Promise<CombatState & { updatedAt?: string }> {
  const current = await getCombat();
  const names = new Set<string>();
  for (const participant of current.participants) {
    if (participant.kind !== 'player') continue;
    const name = (participant.sourceId ?? participant.name ?? '').trim();
    if (name) names.add(name);
  }

  if (names.size > 0) {
    const col = await players();
    const updatedAt = new Date().toISOString();
    for (const name of names) {
      await col.updateOne(
        { name },
        { $set: { cooldowns: {}, activeEffects: {}, updatedAt } },
        { collation: CI },
      );
    }
  }

  return replaceCombat({ ...EMPTY_COMBAT });
}
