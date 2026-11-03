import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { emitLive } from '../livePublish';
import {
  PLAYER_NOTE_MAX,
  getPlayerNote,
  resolveNoteTarget,
  resolvePlayerName,
  savePlayerNote,
  type PlayerNoteKind,
} from '../playerNotes';

function header(req: ApiRequest, key: string): string | undefined {
  const value = req.headers?.[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
const isAdmin = (req: ApiRequest) => header(req, 'x-app-role') === 'admin';

/** Player con el que entró el User (cabecera X-App-Player, en encodeURIComponent). */
function playerHeader(req: ApiRequest): string {
  const raw = header(req, 'x-app-player');
  if (!raw) throw new HttpError(403, 'Elige tu player para usar las notas privadas');
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'Cabecera X-App-Player inválida');
  }
  name = name.trim();
  if (!name || name.length > 100) throw new HttpError(400, 'Cabecera X-App-Player inválida');
  return name;
}

function parseKind(value: string | undefined): PlayerNoteKind {
  if (value === 'champion' || value === 'npc') return value;
  throw new HttpError(400, 'kind tiene que ser champion o npc');
}

function parseText(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Cuerpo inválido');
  const raw = (body as Record<string, unknown>).text ?? '';
  if (typeof raw !== 'string') throw new HttpError(400, 'La nota tiene que ser un texto');
  const text = raw.trim();
  if (text.length > PLAYER_NOTE_MAX) throw new HttpError(400, `La nota admite como máximo ${PLAYER_NOTE_MAX} caracteres`);
  return text;
}

/**
 * /api/player-notes — notas privadas del player sobre un campeón o NPC.
 * Identidad: X-App-Player (nombre del player); el admin no tiene notas (403).
 * Cada player solo lee y escribe las suyas: la clave sale siempre de su cabecera.
 * GET ?kind=champion|npc&id=        { kind, id, text, updatedAt }
 * PUT ?kind=&id= { text }            guarda (texto vacío = borra)
 * El aviso en vivo solo dice «playerNotes cambió»: ni texto ni player; cada pestaña vuelve a pedir la suya.
 */
export default withErrors(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'PUT') throw new HttpError(405, 'Método no permitido');
  if (isAdmin(req)) throw new HttpError(403, 'Las notas privadas son solo de los players');
  const player = await resolvePlayerName(playerHeader(req));
  const kind = parseKind(queryValue(req.query, 'kind'));
  const id = queryValue(req.query, 'id')?.trim() ?? '';
  if (!id || id.length > 200) throw new HttpError(400, 'Falta la ficha (?id=)');
  const target = await resolveNoteTarget(kind, id);

  if (req.method === 'GET') {
    res.status(200).json(await getPlayerNote(player, kind, target, id));
    return;
  }
  assertWriteAccess(req);
  const saved = await savePlayerNote(player, kind, target, id, parseText(req.body));
  const clientId = header(req, 'x-client-id');
  await emitLive({ resources: ['playerNotes'], ...(clientId && clientId.length <= 100 ? { clientId } : {}) });
  res.status(200).json(saved);
});
