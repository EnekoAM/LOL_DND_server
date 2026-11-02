import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { setLocalBroadcaster, type LiveEvent } from './livePublish';

/**
 * WebSocket local de `npm run dev:api` para la sincronización en vivo entre pestañas.
 * Los avisos los genera withLive (server/livePublish.ts) tras cada escritura correcta;
 * aquí solo se reparten a los navegadores conectados. En Vercel no hay WebSocket propio:
 * allí el aviso va por Ably (ABLY_API_KEY).
 */
export type { LiveEvent, LiveResource } from './livePublish';

export const LIVE_PATH = '/ws';

let wss: WebSocketServer | undefined;

export function attachLiveSync(server: Server): void {
  wss = new WebSocketServer({ server, path: LIVE_PATH });
  wss.on('connection', socket => {
    (socket as WebSocket & { alive?: boolean }).alive = true;
    socket.on('pong', () => {
      (socket as WebSocket & { alive?: boolean }).alive = true;
    });
    socket.on('error', () => socket.terminate());
  });

  // Latido: corta las conexiones muertas (portátil suspendido, wifi caída…).
  const heartbeat = setInterval(() => {
    for (const client of wss?.clients ?? []) {
      const socket = client as WebSocket & { alive?: boolean };
      if (socket.alive === false) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  setLocalBroadcaster(broadcast);
}

export function broadcast(event: LiveEvent): void {
  if (!wss || event.resources.length === 0) return;
  const message = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
