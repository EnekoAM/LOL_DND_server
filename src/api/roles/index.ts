import { HttpError } from '../../errors';
import { queryValue, withErrors } from '../../http';
import { listRoles } from '../../store';
import roleById from '../../handlers/roleById';
import { withLive } from '../../livePublish';

// En Vercel, /api/roles/:id se reescribe a /api/roles?id=:id (vercel.json),
// así que este handler delega en el de un rol cuando llega ?id=.
export default withLive({ PATCH: ['roles'] }, withErrors(async (req, res) => {
  const id = queryValue(req.query, 'id')?.trim();
  if (id) return roleById(req, res);
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
  res.status(200).json(await listRoles());
}));