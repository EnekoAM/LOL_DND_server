import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors } from '../http';
import { getPlayer, updatePlayer, upsertPlayer } from '../store';
import { parsePlayerPatch, parsePlayerReplace } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ PATCH: ['players'], PUT: ['players'] }, withErrors(async (req, res) => {
  const name = queryValue(req.query, 'name')?.trim();
  if (!name) throw new HttpError(400, 'Falta el nombre del jugador');

  if (req.method === 'GET') {
    res.status(200).json(await getPlayer(name));
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    res.status(200).json(await updatePlayer(name, parsePlayerPatch(req.body)));
    return;
  }
  if (req.method === 'PUT') {
    assertWriteAccess(req);
    res.status(200).json(await upsertPlayer(name, parsePlayerReplace(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
