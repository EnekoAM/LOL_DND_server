import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors } from '../http';
import { getRole, updateRole } from '../store';
import { isRoleId, parseRolePatch } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ PATCH: ['roles'] }, withErrors(async (req, res) => {
  const id = queryValue(req.query, 'id')?.trim() ?? '';
  if (!isRoleId(id)) throw new HttpError(400, 'Falta un id de rol válido (p. ej. asesino-ad)');

  if (req.method === 'GET') {
    res.status(200).json(await getRole(id));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    res.status(200).json(await updateRole(id, parseRolePatch(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
