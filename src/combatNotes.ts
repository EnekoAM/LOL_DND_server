import { ObjectId, type Collection } from 'mongodb';
import { getDb } from './db';
import { HttpError } from './errors';

/**
 * Notas públicas del combate (pestaña «Notas» de Combate): lista compartida para toda la party.
 * Van en su propio documento (colección combatNotes, _id 'current'), aparte del combate activo:
 * no se borran al terminar un combate ni las pisa el PUT del tracker. Solo el admin las vacía.
 */
export type CombatNote = { id: string; text: string; author: string; createdAt: string };

export const COMBAT_NOTE_MAX = 1000;
/** Se guardan las últimas N; las más antiguas se descartan al añadir. */
export const COMBAT_NOTES_LIMIT = 300;
const DOC_ID = 'current';

async function notesCol(): Promise<Collection> {
  return (await getDb()).collection('combatNotes');
}

function clean(raw: unknown): CombatNote[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((note): note is CombatNote => !!note && typeof note === 'object'
    && typeof (note as CombatNote).id === 'string'
    && typeof (note as CombatNote).text === 'string'
    && typeof (note as CombatNote).author === 'string'
    && typeof (note as CombatNote).createdAt === 'string')
    .map(note => ({ id: note.id, text: note.text, author: note.author, createdAt: note.createdAt }));
}

export async function listCombatNotes(): Promise<CombatNote[]> {
  const doc = await (await notesCol()).findOne({ _id: DOC_ID as never });
  return clean(doc?.notes);
}

export async function addCombatNote(text: string, author: string): Promise<CombatNote[]> {
  const note: CombatNote = { id: new ObjectId().toHexString(), text, author: author.slice(0, 80), createdAt: new Date().toISOString() };
  await (await notesCol()).updateOne(
    { _id: DOC_ID as never },
    { $push: { notes: { $each: [note], $slice: -COMBAT_NOTES_LIMIT } } as never, $set: { updatedAt: note.createdAt } },
    { upsert: true },
  );
  return listCombatNotes();
}

/** Borra una nota. onlyAuthor: solo si la escribió ese player (sin distinguir mayúsculas). */
export async function deleteCombatNote(id: string, onlyAuthor?: string): Promise<CombatNote[]> {
  const note = (await listCombatNotes()).find(entry => entry.id === id);
  if (!note) throw new HttpError(404, 'Esa nota ya no existe');
  if (onlyAuthor !== undefined && note.author.toLocaleLowerCase('es') !== onlyAuthor.toLocaleLowerCase('es')) {
    throw new HttpError(403, 'Solo puedes borrar tus propias notas');
  }
  await (await notesCol()).updateOne(
    { _id: DOC_ID as never },
    { $pull: { notes: { id } } as never, $set: { updatedAt: new Date().toISOString() } },
  );
  return listCombatNotes();
}

export async function clearCombatNotes(): Promise<CombatNote[]> {
  await (await notesCol()).updateOne(
    { _id: DOC_ID as never },
    { $set: { notes: [], updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
  return [];
}
