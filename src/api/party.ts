import { HttpError } from '../errors';
import { assertWriteAccess, withErrors } from '../http';
import { getParty, updateParty } from '../store';
import { parsePartyPatch } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ PATCH: ['party', 'players'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await getParty());
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    res.status(200).json(await updateParty(parsePartyPatch(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
