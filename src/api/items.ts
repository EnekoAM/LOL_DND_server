import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { createItem, deleteItem, getItems, grantItem, updateItem } from '../store';
import { parseItemCreate, parseItemUpdate, parseRollRecord } from '../validate';
import { withLive } from '../livePublish';

/** Rol blando (localStorage) que manda el cliente, como en aumentos: crear y borrar \u00edtems solo el admin. */
function assertAdminRole(req: ApiRequest): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, 'Solo el admin puede a\u00f1adir o borrar \u00edtems');
}

export default withLive({ PATCH: ['items', 'history'], PUT: ['items', 'loot'], POST: ['items', 'loot'], DELETE: ['items', 'loot'] }, withErrors(async (req, res) => {
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
  // POST crea un \u00edtem nuevo (nombre \u00fanico); DELETE borra uno creado desde la app.
  if (req.method === 'POST') {
    assertWriteAccess(req);
    assertAdminRole(req);
    res.status(201).json(await createItem(parseItemCreate(req.body)));
    return;
  }
  if (req.method === 'DELETE') {
    assertWriteAccess(req);
    assertAdminRole(req);
    if (!nombre) throw new HttpError(400, 'Falta el nombre del \u00edtem');
    res.status(200).json(await deleteItem(nombre));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
