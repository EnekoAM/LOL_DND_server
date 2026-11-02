import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createFaq, deleteFaq, listFaq, updateFaq } from '../store';
import { parseFaqInput, parseFaqPatch } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function assertAdminRole(req: ApiRequest): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, 'Solo el admin puede editar las Mecánicas');
}

function faqId(req: ApiRequest): string {
  let id = queryValue(req.query, 'id');
  if (!id && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const value = (req.body as Record<string, unknown>).id;
    if (typeof value === 'string') id = value;
  }
  if (!id?.trim()) throw new HttpError(400, 'Falta la entrada');
  return id.trim();
}

/** Mecánicas (FAQ): leer cualquiera; crear/editar/reordenar/borrar solo admin. */
export default withLive({ POST: ['faq'], PATCH: ['faq'], DELETE: ['faq'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listFaq());
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(201).json(await createFaq(parseFaqInput(req.body)));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(200).json(await updateFaq(faqId(req), parseFaqPatch(req.body)));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(200).json(await deleteFaq(faqId(req)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
