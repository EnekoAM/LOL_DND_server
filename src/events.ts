import { ObjectId, type AnyBulkWriteOperation, type Collection, type Document } from 'mongodb';
import { getDb } from './db';
import { HttpError } from './errors';

/**
 * Eventos de la campaña (colección events): lo que pasó en las sesiones y lo que
 * el admin planea que pase. El orden de la línea temporal es explícito (order),
 * no la fecha, para poder meter eventos futuros entre otros ya ocurridos.
 * Documento: { title, body, status, session?, date?, visibleToPlayers, order, createdAt, updatedAt? }
 */
export type EventStatus = 'pasado' | 'futuro';

export type CampaignEvent = {
  id: string;
  title: string;
  /** Texto con el formato ligero de Mecánicas (párrafos, listas, **negrita**). Puede ir vacío. */
  body: string;
  status: EventStatus;
  /** Etiqueta libre: «Sesión 3», «Día 12 del viaje»… */
  session?: string;
  /** Fecha real o de la campaña (YYYY-MM-DD). */
  date?: string;
  /** Los players solo ven los marcados. Por defecto: pasados sí, futuros no. */
  visibleToPlayers: boolean;
  order: number;
  createdAt: string;
  updatedAt?: string;
};

export const EVENT_TITLE_MAX = 140;
export const EVENT_BODY_MAX = 8000;
export const EVENT_SESSION_MAX = 60;
export const EVENT_LIST_MAX = 2000;
const ORDER_STEP = 10;
const STATUSES: readonly EventStatus[] = ['pasado', 'futuro'];
const MISSING = 'No existe ese evento';

export type EventInput = {
  title: string;
  body: string;
  status: EventStatus;
  session?: string;
  date?: string;
  visibleToPlayers: boolean;
  /** Se coloca justo debajo de este evento (si no, al final). */
  afterId?: string;
};

export type EventPatch = {
  title?: string;
  body?: string;
  status?: EventStatus;
  session?: string | null;
  date?: string | null;
  visibleToPlayers?: boolean;
};

// ── Validación ──

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'El cuerpo tiene que ser un objeto JSON');
  }
  return body as Record<string, unknown>;
}

function onlyKeys(source: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new HttpError(400, `Campo desconocido: ${key}`);
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} tiene que ser un texto`);
  const out = value.replace(/\r\n?/g, '\n').trim();
  if (out.length > max) throw new HttpError(400, `${field} puede tener como máximo ${max} caracteres`);
  return out;
}

function title(value: unknown): string {
  const out = text(value, 'title', EVENT_TITLE_MAX);
  if (!out) throw new HttpError(400, 'Falta el título');
  if (/\n/.test(out)) throw new HttpError(400, 'El título tiene que ser una sola línea');
  return out;
}

function status(value: unknown): EventStatus {
  if (typeof value !== 'string' || !STATUSES.includes(value as EventStatus)) {
    throw new HttpError(400, 'status tiene que ser «pasado» o «futuro»');
  }
  return value as EventStatus;
}

function session(value: unknown): string | null {
  if (value === null) return null;
  const out = text(value, 'session', EVENT_SESSION_MAX);
  if (/[\n\t]/.test(out)) throw new HttpError(400, 'session tiene que ser una sola línea');
  return out || null;
}

function date(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new HttpError(400, 'date tiene que ser una fecha AAAA-MM-DD');
  }
  const out = value.trim();
  const [y, m, d] = out.split('-').map(Number) as [number, number, number];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new HttpError(400, 'date no es una fecha válida');
  }
  return out;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${field} tiene que ser true o false`);
  return value;
}

function objectId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ObjectId.isValid(value.trim())) throw new HttpError(400, `${field} no es un id válido`);
  return value.trim();
}

export function parseEventInput(body: unknown): EventInput {
  const source = asObject(body);
  onlyKeys(source, ['title', 'body', 'status', 'session', 'date', 'visibleToPlayers', 'afterId']);
  const st = source.status === undefined ? 'pasado' : status(source.status);
  const input: EventInput = {
    title: title(source.title),
    body: source.body === undefined ? '' : text(source.body, 'body', EVENT_BODY_MAX),
    status: st,
    visibleToPlayers: source.visibleToPlayers === undefined ? st === 'pasado' : bool(source.visibleToPlayers, 'visibleToPlayers'),
  };
  if (source.session !== undefined) {
    const value = session(source.session);
    if (value) input.session = value;
  }
  if (source.date !== undefined) {
    const value = date(source.date);
    if (value) input.date = value;
  }
  if (source.afterId !== undefined && source.afterId !== null) input.afterId = objectId(source.afterId, 'afterId');
  return input;
}

export function parseEventPatch(body: unknown): EventPatch {
  const source = asObject(body);
  onlyKeys(source, ['id', 'title', 'body', 'status', 'session', 'date', 'visibleToPlayers']);
  const patch: EventPatch = {};
  if (source.title !== undefined) patch.title = title(source.title);
  if (source.body !== undefined) patch.body = text(source.body, 'body', EVENT_BODY_MAX);
  if (source.status !== undefined) patch.status = status(source.status);
  if (source.session !== undefined) patch.session = session(source.session);
  if (source.date !== undefined) patch.date = date(source.date);
  if (source.visibleToPlayers !== undefined) patch.visibleToPlayers = bool(source.visibleToPlayers, 'visibleToPlayers');
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'No hay campos para actualizar');
  return patch;
}

/** { ids: [...] } con la línea temporal completa en el orden nuevo. */
export function parseEventOrder(body: unknown): string[] {
  const source = asObject(body);
  onlyKeys(source, ['ids']);
  const { ids } = source;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > EVENT_LIST_MAX) {
    throw new HttpError(400, `ids tiene que ser una lista de 1 a ${EVENT_LIST_MAX} eventos`);
  }
  const out = ids.map(id => objectId(id, 'ids'));
  if (new Set(out).size !== out.length) throw new HttpError(400, 'ids tiene eventos repetidos');
  return out;
}

// ── Mongo ──

let indexReady: Promise<unknown> | undefined;

async function events(): Promise<Collection> {
  const col = (await getDb()).collection('events');
  indexReady ??= col.createIndex({ order: 1 }).catch(error => {
    indexReady = undefined;
    throw error;
  });
  await indexReady;
  return col;
}

function iso(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return undefined;
}

function toEvent(doc: Document): CampaignEvent {
  const st: EventStatus = doc.status === 'futuro' ? 'futuro' : 'pasado';
  const event: CampaignEvent = {
    id: String(doc._id),
    title: typeof doc.title === 'string' ? doc.title : '',
    body: typeof doc.body === 'string' ? doc.body : '',
    status: st,
    visibleToPlayers: typeof doc.visibleToPlayers === 'boolean' ? doc.visibleToPlayers : st === 'pasado',
    order: typeof doc.order === 'number' ? doc.order : 0,
    createdAt: iso(doc.createdAt) ?? '',
  };
  if (typeof doc.session === 'string' && doc.session) event.session = doc.session;
  if (typeof doc.date === 'string' && doc.date) event.date = doc.date;
  const updatedAt = iso(doc.updatedAt);
  if (updatedAt) event.updatedAt = updatedAt;
  return event;
}

const SORT = { order: 1, createdAt: 1, _id: 1 } as const;

/** Línea temporal en orden. Players: solo los visibles. */
export async function listEvents(includeHidden: boolean): Promise<CampaignEvent[]> {
  const filter = includeHidden ? {} : { visibleToPlayers: true };
  const docs = await (await events()).find(filter).sort(SORT).limit(EVENT_LIST_MAX).toArray();
  return docs.map(toEvent);
}

/** Reescribe order = 10, 20, 30… siguiendo la lista de _id. */
async function renumber(col: Collection, ids: ObjectId[]): Promise<void> {
  if (ids.length === 0) return;
  const ops: AnyBulkWriteOperation<Document>[] = ids.map((_id, index) => ({
    updateOne: { filter: { _id }, update: { $set: { order: (index + 1) * ORDER_STEP } } },
  }));
  await col.bulkWrite(ops, { ordered: false });
}

export async function createEvent(input: EventInput): Promise<CampaignEvent> {
  const col = await events();
  const { afterId, ...fields } = input;
  const doc: Document = { ...fields, createdAt: new Date() };
  if (!afterId) {
    const last = await col.find({}).sort({ order: -1 }).limit(1).toArray();
    const top = typeof last[0]?.order === 'number' ? last[0].order : 0;
    doc.order = top + ORDER_STEP;
    const result = await col.insertOne(doc);
    return toEvent({ ...doc, _id: result.insertedId });
  }

  const all = await col.find({}, { projection: { _id: 1 } }).sort(SORT).toArray();
  const index = all.findIndex(item => String(item._id) === afterId);
  if (index < 0) throw new HttpError(404, 'No existe el evento tras el que insertar');
  doc.order = 0; // provisional; se renumera justo después
  const result = await col.insertOne(doc);
  const ids = all.map(item => item._id as ObjectId);
  ids.splice(index + 1, 0, result.insertedId);
  await renumber(col, ids);
  const saved = await col.findOne({ _id: result.insertedId });
  if (!saved) throw new HttpError(404, MISSING);
  return toEvent(saved);
}

export async function updateEvent(id: string, patch: EventPatch): Promise<CampaignEvent> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING);
  const col = await events();
  const _id = new ObjectId(id);
  const $set: Document = { updatedAt: new Date() };
  const $unset: Document = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      if (key === 'session' || key === 'date') $unset[key] = '';
    } else {
      $set[key] = value;
    }
  }
  const update: Document = { $set };
  if (Object.keys($unset).length > 0) update.$unset = $unset;
  const result = await col.updateOne({ _id }, update);
  if (result.matchedCount === 0) throw new HttpError(404, MISSING);
  const doc = await col.findOne({ _id });
  if (!doc) throw new HttpError(404, MISSING);
  return toEvent(doc);
}

export async function deleteEvent(id: string): Promise<{ id: string }> {
  if (!ObjectId.isValid(id)) throw new HttpError(404, MISSING);
  const result = await (await events()).deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) throw new HttpError(404, MISSING);
  return { id };
}

/**
 * Nuevo orden de la línea temporal. Los ids que falten (p. ej. creados en otra pestaña
 * a la vez) se quedan al final en su orden actual; los desconocidos se ignoran.
 */
export async function reorderEvents(ids: string[]): Promise<CampaignEvent[]> {
  const col = await events();
  const all = await col.find({}, { projection: { _id: 1 } }).sort(SORT).toArray();
  const known = new Map(all.map(item => [String(item._id), item._id as ObjectId]));
  const wanted = ids.filter(id => known.has(id));
  const rest = all.map(item => String(item._id)).filter(id => !wanted.includes(id));
  await renumber(col, [...wanted, ...rest].map(id => known.get(id) as ObjectId));
  return listEvents(true);
}
