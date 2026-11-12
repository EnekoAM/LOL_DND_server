import { HttpError } from '../errors';
import { assertWriteAccess, withErrors, type ApiRequest } from '../http';
import { endCombatAndResetTrackers, getCombat, replaceCombat, updatePlayer } from '../store';
import { combatBonuses, parseCombatState, parsePlayerPatch, type CombatParticipant } from '../validate';
import { withLive } from '../livePublish';

function assertAdminRole(req: ApiRequest): void {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  if (role?.trim() !== 'admin') throw new HttpError(403, 'Solo el admin puede editar el combate');
}

function headerValue(req: ApiRequest, name: string): string | undefined {
  const header = req.headers?.[name];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || undefined;
}

/** Player con el que entró el User (X-App-Player, en encodeURIComponent). */
function requestPlayer(req: ApiRequest): string | undefined {
  const raw = headerValue(req, 'x-app-player');
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw).trim() || undefined;
  } catch {
    throw new HttpError(400, 'Cabecera X-App-Player inválida');
  }
}

function isHpPatch(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const op = (body as Record<string, unknown>).op;
  return op === 'hp' || op === 'resource' || op === 'actions' || op === 'bonuses';
}

function hpInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99999) {
    throw new HttpError(400, `${field} tiene que ser un entero entre 0 y 99999`);
  }
  return value;
}

/**
 * Vida (op hp) o recurso (op resource, maná/energía…) en combate.
 * Admin: de cualquiera. User: solo los de su propio player (X-App-Player).
 * Players: se guarda en su ficha (hp/actualHp o mana/actualMana). Resto: en el participante del combate.
 */
async function patchCombatHp(req: ApiRequest) {
  const body = req.body as Record<string, unknown>;
  if (typeof body.participantId !== 'string' || !body.participantId.trim()) {
    throw new HttpError(400, 'participantId tiene que ser un texto');
  }
  if (body.op === 'actions') return patchCombatActions(req, body);
  if (body.op === 'bonuses') return patchCombatBonuses(req, body);
  const resource = body.op === 'resource';
  const current = hpInt(body.current, 'current');
  const max = body.max === undefined || body.max === null ? undefined : hpInt(body.max, 'max');
  // Solo vida: vida temporal y escudo (players: vidaTemporal / escudo de su ficha).
  const tempHp = resource || body.tempHp === undefined || body.tempHp === null ? undefined : hpInt(body.tempHp, 'tempHp');
  const shield = resource || body.shield === undefined || body.shield === null ? undefined : hpInt(body.shield, 'shield');
  const combat = await getCombat();
  const participant = combat.participants.find(p => p.id === body.participantId);
  if (!participant) throw new HttpError(404, 'Ese participante ya no está en el combate');

  const admin = headerValue(req, 'x-app-role') === 'admin';
  const playerName = participant.kind === 'player' ? (participant.sourceId ?? participant.name).trim() : '';
  if (!admin) {
    const me = requestPlayer(req);
    if (!playerName || !me || me.toLocaleLowerCase('es') !== playerName.toLocaleLowerCase('es')) {
      throw new HttpError(403, resource ? 'Solo puedes editar tu propio recurso' : 'Solo puedes editar tu propia vida');
    }
  }

  if (playerName) {
    const [maxKey, currentKey] = resource ? ['mana', 'actualMana'] : ['hp', 'actualHp'];
    const patch = parsePlayerPatch({
      ...(max === undefined ? { [currentKey]: current } : { [maxKey]: max, [currentKey]: Math.min(current, max) }),
      ...(tempHp === undefined ? {} : { vidaTemporal: tempHp }),
      ...(shield === undefined ? {} : { escudo: shield }),
    });
    const player = await updatePlayer(playerName, patch);
    return { combat, player };
  }

  if (resource) {
    // Máximo por defecto: stats / Recurso del campeón (cliente). max lo sustituye solo en este participante.
    const cap = max ?? participant.resourceMax;
    const withResource = {
      ...combat,
      participants: combat.participants.map(p => (p.id === participant.id
        ? { ...p, currentResource: cap === undefined ? current : Math.min(current, cap), ...(max === undefined ? {} : { resourceMax: max }) }
        : p)),
    };
    return { combat: await replaceCombat(parseCombatState(withResource)) };
  }
  const nextMax = max ?? participant.maxHp;
  const next = {
    ...combat,
    participants: combat.participants.map(p => (p.id === participant.id
      ? {
          ...p,
          hp: nextMax === undefined ? current : Math.min(current, nextMax),
          ...(nextMax === undefined ? {} : { maxHp: nextMax }),
          ...(tempHp === undefined ? {} : { tempHp }),
          ...(shield === undefined ? {} : { shield }),
        }
      : p)),
  };
  return { combat: await replaceCombat(parseCombatState(next)) };
}

/**
 * op actions: ataques / habilidades / usos de objeto que le quedan este turno (left) y cuántas son extra.
 * Admin: de cualquiera. User: solo su propio player. Se guarda en el participante del combate.
 */
async function patchCombatActions(req: ApiRequest, body: Record<string, unknown>) {
  const kind = body.kind;
  if (kind !== 'attacks' && kind !== 'abilities' && kind !== 'items') throw new HttpError(400, 'kind tiene que ser attacks, abilities o items');
  const count = (value: unknown, field: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99) {
      throw new HttpError(400, `${field} tiene que ser un entero entre 0 y 99`);
    }
    return value;
  };
  const left = count(body.left, 'left');
  const extra = count(body.extra ?? 0, 'extra');
  const combat = await getCombat();
  const participant = combat.participants.find(p => p.id === body.participantId);
  if (!participant) throw new HttpError(404, 'Ese participante ya no está en el combate');
  if (headerValue(req, 'x-app-role') !== 'admin') {
    const playerName = participant.kind === 'player' ? (participant.sourceId ?? participant.name).trim() : '';
    const me = requestPlayer(req);
    if (!playerName || !me || me.toLocaleLowerCase('es') !== playerName.toLocaleLowerCase('es')) {
      throw new HttpError(403, 'Solo puedes editar tus propias acciones');
    }
  }
  const next = {
    ...combat,
    participants: combat.participants.map(p => (p.id === participant.id
      ? {
          ...p,
          actionsLeft: { ...p.actionsLeft, [kind]: left },
          actionsExtra: { ...p.actionsExtra, [kind]: extra },
        }
      : p)),
  };
  return { combat: await replaceCombat(parseCombatState(next)) };
}

/**
 * op bonuses: sustituye los bonus temporales de un participante.
 * Admin: de cualquiera. User: solo su propio player (campeones / NPCs, solo admin).
 */
async function patchCombatBonuses(req: ApiRequest, body: Record<string, unknown>) {
  const bonuses = combatBonuses(body.bonuses);
  const combat = await getCombat();
  const participant = combat.participants.find(p => p.id === body.participantId);
  if (!participant) throw new HttpError(404, 'Ese participante ya no está en el combate');
  if (headerValue(req, 'x-app-role') !== 'admin') {
    const playerName = participant.kind === 'player' ? (participant.sourceId ?? participant.name).trim() : '';
    const me = requestPlayer(req);
    if (!playerName || !me || me.toLocaleLowerCase('es') !== playerName.toLocaleLowerCase('es')) {
      throw new HttpError(403, 'Solo puedes editar tus propios bonus');
    }
  }
  const next = {
    ...combat,
    participants: combat.participants.map(p => {
      if (p.id !== participant.id) return p;
      const { bonuses: _old, ...rest } = p;
      return bonuses.length ? { ...rest, bonuses } : rest;
    }),
  };
  return { combat: await replaceCombat(parseCombatState(next)) };
}

const isAdminRequest = (req: ApiRequest): boolean => {
  const header = req.headers?.['x-app-role'];
  const role = Array.isArray(header) ? header[0] : header;
  return role?.trim() === 'admin';
};

/** Las stats / habilidades de los NPCs son solo del admin: fuera la copia para el resto. */
function redactCombat<T extends { participants: CombatParticipant[] }>(combat: T, admin: boolean): T {
  if (admin || !combat.participants.some(p => p.kind === 'npc' && p.sheet)) return combat;
  return {
    ...combat,
    participants: combat.participants.map(p => {
      if (p.kind !== 'npc' || !p.sheet) return p;
      const { sheet: _sheet, ...rest } = p;
      return rest;
    }),
  };
}

/** Combate activo: leer cualquiera; sustituir/terminar solo admin + write key. */
export default withLive(
  // players también: al terminar hay que refrescar CD/efectos en todas las pestañas.
  { PUT: ['combat', 'players'], PATCH: ['combat', 'players'], POST: ['combat', 'players'] },
  withErrors(async (req, res) => {
    if (req.method === 'GET') {
      res.status(200).json(redactCombat(await getCombat(), isAdminRequest(req)));
      return;
    }
    if (req.method === 'POST') {
      assertWriteAccess(req);
      assertAdminRole(req);
      res.status(200).json(await endCombatAndResetTrackers());
      return;
    }
    if (req.method === 'PATCH' && isHpPatch(req.body)) {
      assertWriteAccess(req);
      const result = await patchCombatHp(req);
      res.status(200).json({ ...result, combat: redactCombat(result.combat, isAdminRequest(req)) });
      return;
    }
    if (req.method === 'PUT' || req.method === 'PATCH') {
      assertWriteAccess(req);
      assertAdminRole(req);
      const next = parseCombatState(req.body);
      const current = await getCombat();
      // Cualquier vuelta a Preparación desde combate activo: reset completo.
      if (current.active && !next.active) {
        res.status(200).json(await endCombatAndResetTrackers());
        return;
      }
      res.status(200).json(await replaceCombat(next));
      return;
    }
    throw new HttpError(405, 'Método no permitido');
  }),
);
