import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors } from '../http';
import { craftItem, craftRecursive } from '../store';
import { withLive } from '../livePublish';

function flag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export default withLive({ POST: ['items', 'party', 'history'] }, withErrors(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  assertWriteAccess(req);
  const nombre = queryValue(req.query, 'nombre')?.trim();
  if (!nombre) throw new HttpError(400, 'Falta el nombre del ítem');
  const recursive = flag(queryValue(req.query, 'recursive'));
  if (!recursive) {
    res.status(200).json(await craftItem(nombre));
    return;
  }
  const buyMissing = flag(queryValue(req.query, 'buyMissing'));
  const preview = flag(queryValue(req.query, 'preview'));
  res.status(200).json(await craftRecursive(nombre, { buyMissing, preview }));
}));
