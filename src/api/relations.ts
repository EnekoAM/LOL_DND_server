import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createRelation, deleteRelation, listRelationsFor, updateRelationNote } from '../store';
import { parseRelationInput, parseRelationNote, parseRelationRef } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function isAdmin(req: ApiRequest): boolean {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
}

function assertAdminRole(req: ApiRequest): void {
  if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede gestionar las relaciones');
}

function relationId(req: ApiRequest): string {
  const fromQuery = queryValue(req.query, 'id')?.trim();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const fromBody = typeof body.id === 'string' ? body.id.trim() : '';
  const id = fromQuery || fromBody;
  if (!id) throw new HttpError(400, 'Falta la relación (?id=)');
  return id;
}

/**
 * /api/relations — relaciones entre campeones y NPCs (simétricas: se ven desde las dos fichas).
 * GET    ?kind=champion|npc&id=   relaciones de esa ficha con la otra punta resuelta.
 *                                 Players: solo si la ficha es visible y solo con fichas visibles.
 * POST   { a, b, note? }          crea (admin). a/b = { kind, id }; campeón = nombre, NPC = id.
 * PATCH  ?id= { note }            cambia la nota (admin).
 * DELETE ?id=                     borra (admin).
 */
export default withLive({ POST: ['relations'], PATCH: ['relations'], DELETE: ['relations'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    const ref = parseRelationRef({ kind: queryValue(req.query, 'kind'), id: queryValue(req.query, 'id') }, 'La ficha');
    res.status(200).json(await listRelationsFor(ref, !isAdmin(req)));
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(201).json(await createRelation(parseRelationInput(req.body)));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    assertAdminRole(req);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    res.status(200).json(await updateRelationNote(relationId(req), parseRelationNote(body.note)));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(200).json(await deleteRelation(relationId(req)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
