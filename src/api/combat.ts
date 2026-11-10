import { HttpError } from '../errors';
import { assertWriteAccess, withErrors, type ApiRequest } from '../http';
import { endCombatAndResetTrackers, getCombat, replaceCombat } from '../store';
import { parseCombatState } from '../validate';
import { withLive } from '../livePublish';

function assertAdminRole(req: ApiRequest): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, 'Solo el admin puede editar el combate');
}

/** Combate activo: leer cualquiera; sustituir/terminar solo admin + write key. */
export default withLive(
  { PUT: ['combat'], PATCH: ['combat'], POST: ['combat', 'players'] },
  withErrors(async (req, res) => {
    if (req.method === 'GET') {
      res.status(200).json(await getCombat());
      return;
    }
    if (req.method === 'POST') {
      assertWriteAccess(req);
      assertAdminRole(req);
      // Terminar: vacía Preparación y limpia CD/efectos de los players del combate.
      res.status(200).json(await endCombatAndResetTrackers());
      return;
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      assertWriteAccess(req);
      assertAdminRole(req);
      res.status(200).json(await replaceCombat(parseCombatState(req.body)));
      return;
    }
    throw new HttpError(405, 'Método no permitido');
  }),
);
