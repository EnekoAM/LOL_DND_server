import { HttpError } from './errors';
import { getDb } from './db';

/**
 * Efectos con nombre (Mongo: namedEffectsCustom). Es la unica fuente: el cliente ya no tiene lista en el codigo.
 * - Efecto:   { _id: 'mi-efecto', name, en, kind, exclusive, shared, baseSelectable?, description?, wikiItems?, order }.
 * - Variante: { _id: 'base:clave', name, short, description?, wikiItems?, order }.
 * Sus descripciones / bonus / area (las que escribe el admin) siguen en namedEffectDescriptions (mismo id).
 * Las mecanicas del codigo (rollAmps, itemCombatHooks...) van por id: si el id no esta aqui, simplemente no aplican.
 */
export type NamedEffectKind = 'active' | 'passive';
export type NamedEffectVariantOut = { key: string; name: string; short: string; description: string; wikiItems: string[] };
export type NamedEffectOut = {
  id: string;
  name: string;
  en: string;
  kind: NamedEffectKind;
  exclusive: boolean;
  shared: boolean;
  baseSelectable?: boolean;
  description?: string;
  wikiItems?: string[];
  variants?: NamedEffectVariantOut[];
};

type EffectDoc = {
  _id: string;
  name?: string;
  en?: string;
  kind?: NamedEffectKind;
  exclusive?: boolean;
  shared?: boolean;
  baseSelectable?: boolean;
  description?: string;
  wikiItems?: string[];
  short?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ItemDoc = { nombre: string; namedEffects?: unknown };

const EFFECT_ID = /^[a-z0-9-]{1,60}(:[a-z0-9-]{1,30})?$/;
const ITEM_MAX_NAMED_EFFECTS = 10;
const NAME_MAX = 80;
const SHORT_MAX = 40;

async function effectsCol() {
  return (await getDb()).collection<EffectDoc>('namedEffectsCustom');
}

async function itemsCol() {
  return (await getDb()).collection<ItemDoc>('items');
}

const baseOf = (id: string): string => id.split(':')[0];
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Ids afectados: la variante sola, o el efecto base con todas sus variantes. */
const idPattern = (id: string): RegExp => id.includes(':') ? new RegExp(`^${escapeRegex(id)}$`) : new RegExp(`^${escapeRegex(id)}(:|$)`);
const strings = (raw: unknown): string[] => Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];

function parseId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!EFFECT_ID.test(id)) throw new HttpError(400, 'Id de efecto no v\u00e1lido (min\u00fasculas, n\u00fameros y guiones; variante: base:clave)');
  return id;
}

function parseName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > NAME_MAX) throw new HttpError(400, `El nombre es obligatorio (m\u00e1ximo ${NAME_MAX} caracteres)`);
  return name;
}

function parseShort(raw: unknown, fallback: string): string {
  const short = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return (short || fallback).slice(0, SHORT_MAX);
}

/** Todos los efectos con sus variantes, en el orden guardado (para GET /api/named-effects). */
export async function listNamedEffects(): Promise<NamedEffectOut[]> {
  const docs = await (await effectsCol()).find({}).sort({ order: 1, createdAt: 1 }).toArray();
  const effects: NamedEffectOut[] = [];
  const byId = new Map<string, NamedEffectOut>();
  for (const doc of docs) {
    if (typeof doc._id !== 'string' || !EFFECT_ID.test(doc._id) || doc._id.includes(':') || typeof doc.name !== 'string' || !doc.name) continue;
    const wikiItems = strings(doc.wikiItems);
    const effect: NamedEffectOut = {
      id: doc._id,
      name: doc.name,
      en: typeof doc.en === 'string' && doc.en ? doc.en : doc.name,
      kind: doc.kind === 'active' ? 'active' : 'passive',
      exclusive: doc.exclusive === true,
      shared: doc.shared === true,
      ...(doc.baseSelectable === true ? { baseSelectable: true } : {}),
      ...(typeof doc.description === 'string' && doc.description ? { description: doc.description } : {}),
      ...(wikiItems.length ? { wikiItems } : {}),
    };
    effects.push(effect);
    byId.set(effect.id, effect);
  }
  for (const doc of docs) {
    if (typeof doc._id !== 'string' || !EFFECT_ID.test(doc._id) || !doc._id.includes(':') || typeof doc.name !== 'string' || !doc.name) continue;
    const [base, key] = doc._id.split(':');
    const parent = byId.get(base);
    if (!parent) continue;
    parent.variants = [...(parent.variants ?? []), {
      key,
      name: doc.name,
      short: typeof doc.short === 'string' && doc.short ? doc.short : doc.name,
      description: typeof doc.description === 'string' ? doc.description : '',
      wikiItems: strings(doc.wikiItems),
    }];
  }
  return effects;
}

/** Ids de efecto / variante que existen. Lanza 400 con el primero que no exista. */
export async function assertNamedEffectIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const found = await (await effectsCol()).find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
  const have = new Set(found.map(doc => doc._id));
  const missing = ids.find(id => !have.has(id));
  if (missing) throw new HttpError(400, `Efecto con nombre desconocido: ${missing}`);
}

async function nextOrder(filter: Record<string, unknown>): Promise<number> {
  const last = await (await effectsCol()).find(filter).sort({ order: -1 }).limit(1).toArray();
  return (typeof last[0]?.order === 'number' ? last[0].order : 0) + 10;
}

/** Crea un efecto (id sin ':') o una variante ('base:clave'). */
export async function createNamedEffect(body: Record<string, unknown>): Promise<{ id: string }> {
  const id = parseId(body.id);
  const name = parseName(body.name);
  const col = await effectsCol();
  if (await col.findOne({ _id: id })) throw new HttpError(409, 'Ya existe un efecto con ese id');
  const now = new Date().toISOString();
  if (id.includes(':')) {
    const base = baseOf(id);
    const parent = await col.findOne({ _id: base });
    if (!parent) throw new HttpError(404, `No existe el efecto ${base}`);
    const siblings = await col.countDocuments({ _id: new RegExp(`^${escapeRegex(base)}:`) });
    await col.insertOne({ _id: id, name, short: parseShort(body.short, name), order: await nextOrder({ _id: new RegExp(`^${escapeRegex(base)}:`) }), createdAt: now, updatedAt: now });
    // Primera variante de un efecto sin variantes: el base sigue elegible (los items que ya lo tenian siguen valiendo).
    if (siblings === 0 && parent.baseSelectable !== true) await col.updateOne({ _id: base }, { $set: { baseSelectable: true, updatedAt: now } });
    return { id };
  }
  await col.insertOne({
    _id: id,
    name,
    en: typeof body.en === 'string' && body.en.trim() ? body.en.trim().slice(0, NAME_MAX) : name,
    kind: body.kind === 'active' ? 'active' : 'passive',
    exclusive: body.exclusive === true,
    shared: body.shared === true,
    order: await nextOrder({ _id: { $not: /:/ } }),
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

/** Edita nombre / tipo / unico / compartido / base elegible (efecto) o nombre / etiqueta (variante). */
export async function updateNamedEffect(body: Record<string, unknown>): Promise<{ id: string }> {
  const id = parseId(body.id);
  const col = await effectsCol();
  const existing = await col.findOne({ _id: id });
  if (!existing) throw new HttpError(404, `No existe el efecto ${id}`);
  const set: Partial<EffectDoc> = { updatedAt: new Date().toISOString() };
  if ('name' in body) set.name = parseName(body.name);
  if (id.includes(':')) {
    if ('short' in body) set.short = parseShort(body.short, set.name ?? existing.name ?? id);
  } else {
    if ('en' in body) set.en = typeof body.en === 'string' && body.en.trim() ? body.en.trim().slice(0, NAME_MAX) : (set.name ?? existing.name ?? id);
    if ('kind' in body) set.kind = body.kind === 'active' ? 'active' : 'passive';
    if ('exclusive' in body) set.exclusive = body.exclusive === true;
    if ('shared' in body) set.shared = body.shared === true;
    if ('baseSelectable' in body) set.baseSelectable = body.baseSelectable === true;
  }
  await col.updateOne({ _id: id }, { $set: set });
  return { id };
}

/**
 * Borra un efecto / variante (un efecto base con todas sus variantes) y sus datos de namedEffectDescriptions.
 * Si algun item lo tiene y no hay force, no borra nada y devuelve { inUse }. Con force se lo quita a esos items.
 */
export async function deleteNamedEffect(rawId: unknown, force: boolean): Promise<{ inUse: number } | { id: string; itemsUpdated: number }> {
  const id = parseId(rawId);
  const col = await effectsCol();
  const pattern = idPattern(id);
  const items = await itemsCol();
  const using = await items.countDocuments({ namedEffects: pattern });
  if (using > 0 && !force) return { inUse: using };
  let itemsUpdated = 0;
  if (using > 0) {
    const result = await items.updateMany({ namedEffects: pattern }, { $pull: { namedEffects: pattern } } as never);
    itemsUpdated = result.modifiedCount;
    await items.updateMany({ namedEffects: { $size: 0 } }, { $unset: { namedEffects: '' } });
  }
  await col.deleteMany({ _id: pattern });
  await (await getDb()).collection<{ _id: string }>('namedEffectDescriptions').deleteMany({ _id: pattern });
  return { id, itemsUpdated };
}

/**
 * Pone o quita un efecto / variante a un item. Al poner, sustituye cualquier otro id del mismo efecto base
 * (un item lleva una sola variante de cada efecto, igual que en el editor del item).
 */
export async function assignNamedEffect(body: Record<string, unknown>): Promise<{ nombre: string; namedEffects: string[] }> {
  const id = parseId(body.id);
  const nombre = typeof body.item === 'string' ? body.item.trim() : '';
  if (!nombre) throw new HttpError(400, 'Falta el \u00edtem');
  const on = body.on !== false;
  if (on) await assertNamedEffectIds([id]);
  const items = await itemsCol();
  const item = await items.findOne({ nombre });
  if (!item) throw new HttpError(404, `No existe el \u00edtem ${nombre}`);
  const current = strings(item.namedEffects);
  const next = on ? [...current.filter(entry => baseOf(entry) !== baseOf(id)), id] : current.filter(entry => entry !== id);
  if (next.length > ITEM_MAX_NAMED_EFFECTS) throw new HttpError(400, `M\u00e1ximo ${ITEM_MAX_NAMED_EFFECTS} efectos con nombre por \u00edtem`);
  if (next.length) await items.updateOne({ nombre }, { $set: { namedEffects: next } });
  else await items.updateOne({ nombre }, { $unset: { namedEffects: '' } });
  return { nombre, namedEffects: next };
}