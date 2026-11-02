import { HttpError } from '../errors';
import { withErrors } from '../http';
import { mongoStatus } from '../store';

export default withErrors(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
  res.status(200).json(await mongoStatus());
});
