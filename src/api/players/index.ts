import { HttpError } from '../../errors';
import { queryValue, withErrors } from '../../http';
import { listPlayers } from '../../store';
import playerByName from '../../handlers/playerByName';
import { withLive } from '../../livePublish';

// En Vercel, /api/players/:name se reescribe a /api/players?name=:name (vercel.json),
// así que este handler delega en el de un jugador cuando llega ?name=.
export default withLive({ PATCH: ['players'], PUT: ['players'] }, withErrors(async (req, res) => {
  const name = queryValue(req.query, 'name')?.trim();
  if (name) return playerByName(req, res);
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
  res.status(200).json(await listPlayers());
}));