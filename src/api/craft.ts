import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors } from '../http';
import { craftItem } from '../store';
import { withLive } from '../livePublish';

export default withLive({ POST: ['items', 'party', 'history'] }, withErrors(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  assertWriteAccess(req);
  const nombre = queryValue(req.query, 'nombre')?.trim();
  if (!nombre) throw new HttpError(400, 'Falta el nombre del ítem');
  res.status(200).json(await craftItem(nombre));
}));
