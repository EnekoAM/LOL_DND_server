import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createMapPoi, deleteMapPoi, listMapPois, updateMapPoi } from '../store';
import { parseMapPoiInput, parseMapPoiPatch } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function assertAdminRole(req: ApiRequest): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, 'Solo el admin puede editar los puntos del mapa');
}

function poiId(req: ApiRequest): string {
  let id = queryValue(req.query, 'id');
  if (!id && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const value = (req.body as Record<string, unknown>).id;
    if (typeof value === 'string') id = value;
  }
  if (!id?.trim()) throw new HttpError(400, 'Falta el punto del mapa');
  return id.trim();
}

/** Puntos de interés propios del mapa: leer cualquiera; crear/mover/borrar solo admin. */
export default withLive({ POST: ['mapPois'], PATCH: ['mapPois'], DELETE: ['mapPois'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listMapPois());
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    assertAdminRole(req);
    // La party es única: si ya había una se mueve (200) en vez de crear otra (201).
    const { poi, replaced } = await createMapPoi(parseMapPoiInput(req.body));
    res.status(replaced ? 200 : 201).json({ ...poi, replaced });
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    assertAdminRole(req);
    const id = poiId(req);
    res.status(200).json(await updateMapPoi(id, parseMapPoiPatch(req.body)));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(200).json(await deleteMapPoi(poiId(req)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
