import { ObjectId, type Collection } from 'mongodb';
import { getDb } from './db';
import { HttpError } from './errors';

/**
 * Notas privadas de cada player sobre un campeón o un NPC (colección playerNotes).
 * Una nota por (player, ficha). Van aparte de players/champions/npcs para que nunca
 * salgan en sus payloads públicos: solo /api/player-notes las devuelve, y solo al propio player.
 * Documento: { player, kind, target, text, createdAt, updatedAt }
 *  - player: nombre canónico del player (tal cual está en players).
 *  - target: campeón en minúsculas / _id del NPC en texto.
 */
export type PlayerNoteKind = 'champion' | 'npc';

export type PlayerNote = {
  kind: PlayerNoteKind;
  /** Lo que mandó el cliente (nombre del campeón / id del NPC). */
  id: string;
  text: string;
  updatedAt: string | null;
};

export const PLAYER_NOTE_MAX = 4000;

const CI = { locale: 'es', strength: 2 } as const;

let indexReady: Promise<unknown> | undefined;

async function notes(): Promise<Collection> {
  const col = (await getDb()).collection('playerNotes');
  indexReady ??= col.createIndex({ player: 1, kind: 1, target: 1 }, { unique: true }).catch(error => {
    indexReady = undefined;
    throw error;
  });
  await indexReady;
  return col;
}

/** Nombre canónico del player (sin distinguir mayúsculas). 403 si no existe. */
export async function resolvePlayerName(name: string): Promise<string> {
  const doc = await (await getDb()).collection('players').findOne({ name }, { projection: { name: 1 }, collation: CI });
  if (!doc || typeof doc.name !== 'string') throw new HttpError(403, 'Ese player no existe');
  return doc.name;
}

/** Clave de la ficha. El NPC tiene que ser visible para players. */
export async function resolveNoteTarget(kind: PlayerNoteKind, id: string): Promise<string> {
  const db = await getDb();
  if (kind === 'champion') {
    const doc = await db.collection('champions').findOne({ champion: id }, { projection: { champion: 1 }, collation: CI });
    if (!doc || typeof doc.champion !== 'string') throw new HttpError(404, `No existe el campeón ${id}`);
    return doc.champion.toLowerCase();
  }
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'No existe ese NPC');
  const doc = await db.collection('npcs').findOne({ _id: new ObjectId(id) }, { projection: { visible: 1 } });
  if (!doc || doc.visible !== true) throw new HttpError(404, 'No existe ese NPC');
  return String(doc._id);
}

export async function getPlayerNote(player: string, kind: PlayerNoteKind, target: string, id: string): Promise<PlayerNote> {
  const doc = await (await notes()).findOne({ player, kind, target });
  return {
    kind,
    id,
    text: typeof doc?.text === 'string' ? doc.text : '',
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt.toISOString() : null,
  };
}

/** Guarda la nota (texto vacío = se borra). */
export async function savePlayerNote(player: string, kind: PlayerNoteKind, target: string, id: string, text: string): Promise<PlayerNote> {
  const col = await notes();
  if (!text) {
    await col.deleteOne({ player, kind, target });
    return { kind, id, text: '', updatedAt: null };
  }
  const now = new Date();
  await col.updateOne(
    { player, kind, target },
    { $set: { text, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return { kind, id, text, updatedAt: now.toISOString() };
}

/** Al borrar una ficha, sus notas dejan de tener sentido. */
export async function deleteNotesFor(kind: PlayerNoteKind, target: string): Promise<void> {
  await (await notes()).deleteMany({ kind, target });
}
