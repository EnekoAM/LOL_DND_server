import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createNpc, deleteNpc, getNpc, listNpcs, updateNpc } from '../store';
import { parseNpcInput } from '../validate';
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
 * PATCH ?id=     edita campos sueltos; abilities/stats se sustituyen enteros (admin)
 * DELETE ?id=    borra (admin)
 */
export default withLive({ POST: ['npcs'], PATCH: ['npcs'], DELETE: ['npcs'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    const id = npcId(req, false);
    const admin = isAdmin(req);
    if (id) {
      const npc = await getNpc(id);
      if (!admin && !npc.visible) throw new HttpError(404, 'No existe ese NPC');
      res.status(200).json(npc);
      return;
    }
    const list = await listNpcs();
    res.status(200).json(admin ? list : list.filter(npc => npc.visible));
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
    assertAdminRole(req);
    const id = npcId(req) as string;
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
