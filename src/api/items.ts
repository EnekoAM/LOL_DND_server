import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors } from '../http';
import { getItems, grantItem, updateItem } from '../store';
import { parseItemUpdate, parseRollRecord } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ PATCH: ['items', 'history'], PUT: ['items', 'loot'] }, withErrors(async (req, res) => {
  const nombre = queryValue(req.query, 'nombre')?.trim();

  if (req.method === 'GET') {
    res.status(200).json(await getItems(nombre || undefined));
    return;
  }
  // PATCH suma una copia y anota la tirada (grantItem). No se usa para editar.
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    if (!nombre) throw new HttpError(400, 'Falta el nombre del ítem');
    res.status(200).json(await grantItem(nombre, parseRollRecord(req.body)));
    return;
  }
  // PUT cambia la definición del ítem: rareza, efectos, stats y coste.
  if (req.method === 'PUT') {
    assertWriteAccess(req);
    if (!nombre) throw new HttpError(400, 'Falta el nombre del ítem');
    res.status(200).json(await updateItem(nombre, parseItemUpdate(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
