import { HttpError } from '../errors';
import { assertWriteAccess, withErrors, type ApiRequest } from '../http';
import { withLive } from '../livePublish';
import { listNamedEffectDescriptions, parseNamedEffectDescriptionPatch, setNamedEffectDescription } from '../namedEffectDescriptions';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function isAdmin(req: ApiRequest): boolean {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
}

/**
 * /api/named-effects — descripciones de los efectos con nombre (Vigor, Hoja encantada (mágica)…).
 * GET    { descriptions: { id: texto }, onHit: { id: boolean } } (cualquiera).
 * PATCH  { id, description?, onHit?, bonus?, area? } (admin). area: { size, user, target, tiles } (tablero); null = sin área.
 *        bonus: { cooldown?, duration?, cdStart?, rules[] }; null = la variante usa la del base.
 *        (admin). Texto vacío borra la descripción; onHit null quita el valor propio (la variante hereda).
 */
export default withLive({ PATCH: ['namedEffects'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listNamedEffectDescriptions());
    return;
  }
  if (req.method === 'PATCH') {
    assertWriteAccess(req);
    if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede editar las descripciones de los efectos');
    res.status(200).json(await setNamedEffectDescription(parseNamedEffectDescriptionPatch(req.body)));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
