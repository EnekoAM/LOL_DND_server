import { HttpError } from '../errors';
import { assertWriteAccess, queryValue, withErrors, type ApiRequest } from '../http';
import { withLive } from '../livePublish';
import { listNamedEffectDescriptions, parseNamedEffectDescriptionPatch, setNamedEffectDescription } from '../namedEffectDescriptions';
import { assignNamedEffect, createNamedEffect, deleteNamedEffect, listNamedEffects, updateNamedEffect } from '../namedEffectsCustom';

/** Rol blando (localStorage) que manda el cliente; igual de confiable que el resto de la app. */
function isAdmin(req: ApiRequest): boolean {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
}

/**
 * /api/named-effects - efectos con nombre (la lista entera vive en la BD) y los datos que escribe el admin.
 * GET    { descriptions, onHit, bonus, area, effects: [{ id, name, en, kind, exclusive, shared, baseSelectable?, description?, wikiItems?, variants? }] } (cualquiera).
 * PATCH  { id, description?, onHit?, bonus?, area? } (admin). area: { size, user, target, tiles } (tablero); null = sin area.
 *        bonus: { cooldown?, duration?, cdStart?, rules[] }; null = la variante usa la del base.
 *        Texto vacio borra la descripcion; onHit null quita el valor propio (la variante hereda).
 * POST   (admin) { action: 'create', id, name, kind?, exclusive?, shared?, short? } crea efecto (id) o variante (base:clave).
 *               { action: 'update', id, name?, en?, kind?, exclusive?, shared?, baseSelectable?, short? } edita un efecto / variante.
 *               { action: 'assign', id, item, on } pone / quita el efecto a un item (sustituye otra variante del mismo base).
 * DELETE ?id=&force=1 (admin) borra un efecto / variante (base: con sus variantes); si lo tienen items y no hay force: 409 { error, inUse }.
 */
export default withLive({ PATCH: ['namedEffects'], POST: ['namedEffects', 'items'], DELETE: ['namedEffects', 'items'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ ...(await listNamedEffectDescriptions()), effects: await listNamedEffects() });
    return;
  }
  assertWriteAccess(req);
  if (!isAdmin(req)) throw new HttpError(403, 'Solo el admin puede editar los efectos');
  if (req.method === 'PATCH') {
    res.status(200).json(await setNamedEffectDescription(parseNamedEffectDescriptionPatch(req.body)));
    return;
  }
  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (body.action === 'create') {
      res.status(200).json(await createNamedEffect(body));
      return;
    }
    if (body.action === 'update') {
      res.status(200).json(await updateNamedEffect(body));
      return;
    }
    if (body.action === 'assign') {
      res.status(200).json(await assignNamedEffect(body));
      return;
    }
    throw new HttpError(400, 'Acci\u00f3n desconocida (create, update o assign)');
  }
  if (req.method === 'DELETE') {
    const result = await deleteNamedEffect(queryValue(req.query, 'id'), queryValue(req.query, 'force') === '1');
    if ('inUse' in result) {
      res.status(409).json({ error: `Lo tienen ${result.inUse} \u00edtem(s)`, inUse: result.inUse });
      return;
    }
    res.status(200).json(result);
    return;
  }
  throw new HttpError(405, 'M\u00e9todo no permitido');
}));