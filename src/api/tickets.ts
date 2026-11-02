import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createTicket, deleteTicket, listTickets, updateTicketStatus } from '../store';
import { parseTicketCreate, parseTicketId, parseTicketStatusUpdate } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function assertAdminRole(req: ApiRequest, message: string): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, message);
}

export default withLive({ POST: ['tickets'], PATCH: ['tickets'], DELETE: ['tickets'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listTickets());
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    res.status(201).json(await createTicket(parseTicketCreate(req.body)));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    assertAdminRole(req, 'Solo el admin puede aceptar o rechazar sugerencias');
    const { id, status } = parseTicketStatusUpdate(req.body);
    res.status(200).json(await updateTicketStatus(id, status));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req, 'Solo el admin puede borrar sugerencias');
    res.status(200).json(await deleteTicket(parseTicketId(queryValue(req.query, 'id'), req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
