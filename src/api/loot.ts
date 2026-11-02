import { HttpError } from '../errors';
import { assertWriteAccess, withErrors } from '../http';
import { getLoot, updateLootRules } from '../store';
import { parseLootRulesPatch } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ PATCH: ['loot'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await getLoot());
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    res.status(200).json(await updateLootRules(parseLootRulesPatch(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
