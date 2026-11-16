import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { withLive } from '../livePublish';
import { resolvePlayerName } from '../playerNotes';
import { COMBAT_NOTE_MAX, addCombatNote, clearCombatNotes, deleteCombatNote, listCombatNotes } from '../combatNotes';

function header(req: ApiRequest, key: string): string | undefined {
  const value = req.headers?.[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
const isAdmin = (req: ApiRequest) => header(req, 'x-app-role') === 'admin';

/** Player con el que entró el User (X-App-Player, en encodeURIComponent). */
function requestPlayer(req: ApiRequest): string | undefined {
  const raw = header(req, 'x-app-player');
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw).trim() || undefined;
  } catch {
    throw new HttpError(400, 'Cabecera X-App-Player inválida');
  }
}

/**
 * /api/combat-notes — notas públicas del combate (toda la party las lee y escribe, como las notas públicas de los NPC).
 * GET                 { notes }
 * POST { text }       añade una nota (autor: Admin / el player de X-App-Player / Invitado)
 * DELETE ?id=         admin: cualquiera · player: solo las suyas
 * DELETE ?all=1       vacía la lista (admin)
 * Aviso en vivo como 'combat': la pestaña de Combate ya lo escucha.
 */
export default withLive({ POST: ['combat'], DELETE: ['combat'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ notes: await listCombatNotes() });
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    if (typeof body.text !== 'string') throw new HttpError(400, 'La nota tiene que ser un texto');
    const text = body.text.trim();
    if (!text) throw new HttpError(400, 'La nota está vacía');
    if (text.length > COMBAT_NOTE_MAX) throw new HttpError(400, `La nota admite como máximo ${COMBAT_NOTE_MAX} caracteres`);
    const player = requestPlayer(req);
    const author = isAdmin(req) ? 'Admin' : player ? await resolvePlayerName(player) : 'Invitado';
    res.status(201).json({ notes: await addCombatNote(text, author) });
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    if (queryValue(req.query, 'all') === '1') {
      if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede vaciar las notas');
      res.status(200).json({ notes: await clearCombatNotes() });
      return;
    }
    const id = queryValue(req.query, 'id')?.trim();
    if (!id) throw new HttpError(400, 'Falta la nota (?id=)');
    if (isAdmin(req)) {
      res.status(200).json({ notes: await deleteCombatNote(id) });
      return;
    }
    const player = requestPlayer(req);
    if (!player) throw new HttpError(403, 'Solo puedes borrar tus propias notas');
    res.status(200).json({ notes: await deleteCombatNote(id, await resolvePlayerName(player)) });
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
