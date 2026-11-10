import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createNpc, deleteNpc, getNpc, listNpcs, updateNpc, type NpcEntry } from '../store';
import { NPC_DESCRIPTION_MAX, parseNpcInput } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function isAdmin(req: ApiRequest): boolean {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
}

function assertAdminRole(req: ApiRequest): void {
  if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede gestionar los NPCs');
}

/** Un player puede editar descripción y notas públicas de un NPC visible. El resto sigue siendo admin. */
const PLAYER_FIELDS = new Set(['id', 'description', 'publicNotes']);

/** Ficha reducida para players: nombre y foto para reconocerlo + descripción; sin habilidades, stats ni el resto de datos. */
function forPlayer(npc: NpcEntry): NpcEntry {
  return {
    id: npc.id,
    name: npc.name,
    kind: npc.kind,
    type: npc.type,
    region: npc.region,
    level: 0,
    image: npc.image,
    imageFrame: npc.imageFrame,
    imageFrameCircle: npc.imageFrameCircle,
    background: npc.background,
    description: npc.description,
    publicNotes: npc.publicNotes ?? '',
    stats: {},
    abilities: [],
    visible: npc.visible,
    createdAt: npc.createdAt,
    ...(npc.updatedAt ? { updatedAt: npc.updatedAt } : {}),
  };
}

/** PATCH de un player: description y/o publicNotes. Cualquier otro campo se rechaza. */
function parsePlayerPatch(body: unknown): { description?: string; publicNotes?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Cuerpo inválido');
  const source = body as Record<string, unknown>;
  if (Object.keys(source).some(key => !PLAYER_FIELDS.has(key))) {
    throw new HttpError(403, 'Los players solo pueden editar la descripción y las notas públicas');
  }
  const patch: { description?: string; publicNotes?: string } = {};
  if ('description' in source) {
    if (typeof source.description !== 'string') throw new HttpError(400, 'La descripción tiene que ser un texto');
    const text = source.description.trim();
    if (text.length > NPC_DESCRIPTION_MAX) throw new HttpError(400, `La descripción admite como máximo ${NPC_DESCRIPTION_MAX} caracteres`);
    patch.description = text;
  }
  if ('publicNotes' in source) {
    if (typeof source.publicNotes !== 'string') throw new HttpError(400, 'Las notas públicas tienen que ser un texto');
    const text = source.publicNotes.trim();
    if (text.length > NPC_DESCRIPTION_MAX) throw new HttpError(400, `Las notas públicas admiten como máximo ${NPC_DESCRIPTION_MAX} caracteres`);
    patch.publicNotes = text;
  }
  if (!('description' in patch) && !('publicNotes' in patch)) {
    throw new HttpError(400, 'No hay campos para actualizar');
  }
  return patch;
}

function npcId(req: ApiRequest, required = true): string | undefined {
  const fromQuery = queryValue(req.query, 'id')?.trim();
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const fromBody = typeof body.id === 'string' ? body.id.trim() : '';
  const id = fromQuery || fromBody;
  if (!id && required) throw new HttpError(400, 'Falta el NPC (?id=)');
  return id || undefined;
}

/**
 * /api/npcs (y /api/npcs/:id)
 * GET            lista (los players solo reciben los visibles) · ?id= uno
 * POST           crea (admin)
 * PATCH ?id=     admin: edita campos sueltos; abilities/stats se sustituyen enteros.
 *                player: description y/o publicNotes de un NPC visible
 * Los players reciben una ficha reducida (nombre, foto y descripción; sin habilidades, stats, tipo, región ni nivel).
 * DELETE ?id=    borra (admin)
 */
export default withLive({ POST: ['npcs'], PATCH: ['npcs'], DELETE: ['npcs', 'relations'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    const id = npcId(req, false);
    const admin = isAdmin(req);
    if (id) {
      const npc = await getNpc(id);
      if (!admin && !npc.visible) throw new HttpError(404, 'No existe ese NPC');
      res.status(200).json(admin ? npc : forPlayer(npc));
      return;
    }
    const list = await listNpcs();
    res.status(200).json(admin ? list : list.filter(npc => npc.visible).map(forPlayer));
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(201).json(await createNpc(parseNpcInput(req.body)));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    const id = npcId(req) as string;
    if (!isAdmin(req)) {
      const current = await getNpc(id);
      if (!current.visible) throw new HttpError(404, 'No existe ese NPC');
      res.status(200).json(forPlayer(await updateNpc(id, parsePlayerPatch(req.body))));
      return;
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? Object.fromEntries(Object.entries(req.body as Record<string, unknown>).filter(([key]) => key !== 'id'))
      : req.body;
    res.status(200).json(await updateNpc(id, parseNpcInput(body, true)));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(200).json(await deleteNpc(npcId(req) as string));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
