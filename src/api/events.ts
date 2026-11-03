import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createEvent, deleteEvent, listEvents, parseEventInput, parseEventOrder, parseEventPatch, reorderEvents, updateEvent } from '../events';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function isAdmin(req: ApiRequest): boolean {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
}

function assertAdminRole(req: ApiRequest): void {
  if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede editar los Eventos');
}

function eventId(req: ApiRequest): string {
  let id = queryValue(req.query, 'id');
  if (!id && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const value = (req.body as Record<string, unknown>).id;
    if (typeof value === 'string') id = value;
  }
  if (!id?.trim()) throw new HttpError(400, 'Falta el evento (?id=)');
  return id.trim();
}

/**
 * /api/events — línea temporal atemporal de la campaña: visibles = ya pasó; ocultos = planeado por el admin.
 * GET            lista ordenada. Players: solo visibleToPlayers; admin (X-App-Role): todos.
 * POST           crear { title, body?, session?, visibleToPlayers?, afterId? } (admin). visibleToPlayers = ya ha pasado.
 * PATCH ?id=     editar campos (admin).
 * DELETE ?id=    borrar (admin).
 * PUT            reordenar { ids: [...] } con la línea completa (admin).
 */
export default withLive({ POST: ['events'], PATCH: ['events'], PUT: ['events'], DELETE: ['events'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listEvents(isAdmin(req)));
    return;
  }
  assertWriteAccess(req);
  assertAdminRole(req);
  if (req.method === 'POST') {
    res.status(201).json(await createEvent(parseEventInput(req.body)));
    return;
  }
  if (req.method === 'PATCH') {
    res.status(200).json(await updateEvent(eventId(req), parseEventPatch(req.body)));
    return;
  }
  if (req.method === 'PUT') {
    res.status(200).json(await reorderEvents(parseEventOrder(req.body)));
    return;
  }
  if (req.method === 'DELETE') {
    res.status(200).json(await deleteEvent(eventId(req)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
