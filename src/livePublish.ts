import * as Ably from 'ably';
import { loadEnv } from './env';
import { logError } from './errors';
import { queryValue, type ApiHandler, type ApiResponse } from './http';

/**
 * Avisos de «este recurso cambió» para la sincronización en vivo entre pestañas.
 * No se manda el documento; cada pestaña lo vuelve a pedir por REST.
 *
 * Dos transportes, ambos opcionales:
 * - WebSocket propio de `npm run dev:api` (server/live.ts lo registra aquí).
 * - Ably, si hay ABLY_API_KEY (funciona también en Vercel, que no mantiene sockets).
 *
 * Este módulo no importa `ws`, así que se puede usar desde las funciones de Vercel.
 */
export type LiveResource = 'party' | 'players' | 'items' | 'loot' | 'roles' | 'champions' | 'history' | 'tickets' | 'augments' | 'mapPois' | 'faq';

export type LiveEvent = {
  type: 'changed';
  resources: LiveResource[];
  /** Jugador concreto, si el cambio vino de /api/players?name= (o /:name). */
  name?: string;
  /** Pestaña que hizo el cambio (cabecera X-Client-Id); ella misma lo ignora. */
  clientId?: string;
};

/** Nombre del evento dentro del canal de Ably. */
export const ABLY_EVENT = 'changed';

let localBroadcast: ((event: LiveEvent) => void) | undefined;

/** Lo usa server/live.ts para enganchar el WebSocket local. */
export function setLocalBroadcaster(fn: (event: LiveEvent) => void): void {
  localBroadcast = fn;
}

export function ablyKey(): string | undefined {
  loadEnv();
  return process.env.ABLY_API_KEY?.trim() || undefined;
}

export function ablyChannelName(): string {
  loadEnv();
  return process.env.ABLY_CHANNEL?.trim() || 'lol-dnd';
}

let rest: Ably.Rest | undefined;
let restKey: string | undefined;

export function ablyRest(): Ably.Rest | undefined {
  const key = ablyKey();
  if (!key) return undefined;
  if (!rest || restKey !== key) {
    rest = new Ably.Rest({ key });
    restKey = key;
  }
  return rest;
}

/** Cuánto esperamos a Ably antes de responder igualmente al cliente. */
const ABLY_TIMEOUT_MS = 2500;

export async function emitLive(event: Omit<LiveEvent, 'type'>): Promise<void> {
  if (event.resources.length === 0) return;
  const full: LiveEvent = { type: 'changed', ...event };

  try {
    localBroadcast?.(full);
  } catch (error) {
    logError(error);
  }

  const client = ablyRest();
  if (!client) return;
  try {
    await Promise.race([
      client.channels.get(ablyChannelName()).publish(ABLY_EVENT, full),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Ably: tiempo de espera agotado')), ABLY_TIMEOUT_MS)),
    ]);
  } catch (error) {
    // Un fallo de Ably no debe tumbar el guardado: solo se pierde el aviso.
    logError(error);
  }
}

type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type LiveRoutes = Partial<Record<WriteMethod, LiveResource[]>>;

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length <= 100 ? trimmed : undefined;
}

/**
 * Envuelve un handler de /api: si la escritura sale bien (2xx), avisa de los recursos
 * indicados para ese método ANTES de responder (en Vercel, al responder la función
 * se congela y el publish a Ably se perdería).
 */
export function withLive(routes: LiveRoutes, handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    const resources = routes[(req.method ?? '').toUpperCase() as WriteMethod];
    if (!resources || resources.length === 0) {
      await handler(req, res);
      return;
    }

    let code = 200;
    let body: unknown;
    let sent = false;
    const capture: ApiResponse = {
      status(next) {
        code = next;
        return capture;
      },
      json(next) {
        body = next;
        sent = true;
      },
    };

    await handler(req, capture);
    if (!sent) return;

    if (code >= 200 && code < 300) {
      await emitLive({
        resources,
        name: queryValue(req.query, 'name'),
        clientId: headerValue(req.headers?.['x-client-id']),
      });
    }
    res.status(code).json(body);
  };
}
