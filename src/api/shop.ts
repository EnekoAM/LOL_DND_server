import { HttpError } from '../errors';
import { assertWriteAccess, withErrors } from '../http';
import { tradeShop } from '../store';
import { parseShopOrder } from '../validate';
import { withLive } from '../livePublish';

export default withLive({ POST: ['items', 'party', 'history'] }, withErrors(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  assertWriteAccess(req);
  res.status(200).json(await tradeShop(parseShopOrder(req.body)));
}));
