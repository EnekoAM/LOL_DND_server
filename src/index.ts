import express, { type NextFunction, type Request, type Response } from 'express';
import augments from './api/augments';
import champions from './api/champions';
import craft from './api/craft';
import faq from './api/faq';
import health from './api/health';
import history from './api/history';
import items from './api/items';
import liveToken from './api/live-token';
import loot from './api/loot';
import mapPois from './api/map-pois';
import party from './api/party';
import playerByName from './handlers/playerByName';
import players from './api/players/index';
import roleById from './handlers/roleById';
import roles from './api/roles/index';
import shop from './api/shop';
import tickets from './api/tickets';
import type { ApiHandler, ApiRequest, ApiResponse } from './http';
import { attachLiveSync } from './live';
import { ablyKey } from './livePublish';
import { loadEnv } from './env';

loadEnv();

// Render (y otros hosts) inyectan PORT; en local se usa 3001.
const PORT = Number(process.env.PORT) || 3001;
// Con Ably activo (o LIVE_WS=0) no se abre el WebSocket local: todo va por Ably.
const useWs = !ablyKey() && process.env.LIVE_WS?.trim() !== '0';

function adapt(handler: ApiHandler) {
  return (req: Request, res: Response) => {
    const query: ApiRequest['query'] = {};
    for (const [key, value] of Object.entries({ ...req.query, ...req.params })) {
      if (typeof value === 'string') query[key] = value;
      else if (Array.isArray(value) && value.every(item => typeof item === 'string')) query[key] = value;
    }
    return handler(
      {
        method: req.method,
        query,
        headers: req.headers as ApiRequest['headers'],
        body: req.body,
      },
      res as unknown as ApiResponse,
    );
  };
}

const app = express();
app.disable('x-powered-by');
// Render/Fly ponen un proxy delante: así req.ip y req.protocol son los reales.
app.set('trust proxy', true);

// CORS para que un frontend en otro dominio (p. ej. Vercel) pueda llamar a la API.
// CORS_ORIGIN = lista separada por comas (https://mi-app.vercel.app,http://localhost:5173).
// Vacío = se acepta cualquier origen (se refleja el Origin de la petición).
const corsOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && (corsOrigins.length === 0 || corsOrigins.includes('*') || corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, X-App-Role, X-Client-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'JSON inválido' });
    return;
  }
  next(error);
});

app.get('/api/health', adapt(health));
// Token corto de Ably para el navegador ({ enabled: false } si no hay ABLY_API_KEY).
app.get('/api/live-token', adapt(liveToken));
app.get('/api/champions', adapt(champions));
app.patch('/api/champions', adapt(champions));
app.get('/api/items', adapt(items));
app.patch('/api/items', adapt(items));
app.put('/api/items', adapt(items));
app.post('/api/craft', adapt(craft));
app.post('/api/shop', adapt(shop));
app.get('/api/history', adapt(history));
app.post('/api/history', adapt(history));
// Sugerencias: crear cualquiera; borrar solo admin (X-App-Role: admin).
app.get('/api/tickets', adapt(tickets));
app.post('/api/tickets', adapt(tickets));
app.patch('/api/tickets', adapt(tickets));
app.delete('/api/tickets', adapt(tickets));
// Catálogo de aumentos: leer cualquiera; crear/editar/borrar solo admin (X-App-Role: admin).
app.get('/api/augments', adapt(augments));
app.post('/api/augments', adapt(augments));
app.patch('/api/augments', adapt(augments));
app.delete('/api/augments', adapt(augments));
// Puntos propios del mapa: leer cualquiera; crear/mover/borrar solo admin. La party es única.
app.get('/api/map-pois', adapt(mapPois));
app.post('/api/map-pois', adapt(mapPois));
app.patch('/api/map-pois', adapt(mapPois));
app.delete('/api/map-pois', adapt(mapPois));
// Mecánicas (FAQ): leer cualquiera; crear/editar/borrar solo admin.
app.get('/api/faq', adapt(faq));
app.post('/api/faq', adapt(faq));
app.patch('/api/faq', adapt(faq));
app.delete('/api/faq', adapt(faq));
app.get('/api/loot', adapt(loot));
app.patch('/api/loot', adapt(loot));
app.get('/api/party', adapt(party));
// Cambiar el nivel recalcula los rangos de habilidad de todos los jugadores.
app.patch('/api/party', adapt(party));
// El cliente escribe con ?name= (igual que en Vercel); /:name se mantiene por compatibilidad.
app.get('/api/players', adapt(players));
app.patch('/api/players', adapt(players));
app.put('/api/players', adapt(players));
app.get('/api/players/:name', adapt(playerByName));
app.patch('/api/players/:name', adapt(playerByName));
app.put('/api/players/:name', adapt(playerByName));
app.get('/api/roles', adapt(roles));
app.patch('/api/roles', adapt(roles));
app.get('/api/roles/:id', adapt(roleById));
app.patch('/api/roles/:id', adapt(roleById));
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const server = app.listen(PORT, () => {
  console.log(`API escuchando en el puerto ${PORT} (http://localhost:${PORT})`);
  console.log(ablyKey() ? 'Ably activo (ABLY_API_KEY): avisos por Ably, WebSocket local desactivado.' : 'Sin ABLY_API_KEY: solo WebSocket local.');
  if (!process.env.MONGODB_URI?.trim()) {
    console.log('MONGODB_URI no está definido. Copia .env.example a .env y pega ahí la cadena.');
  }
});

if (useWs) {
  attachLiveSync(server);
  console.log(`WebSocket local en ws://localhost:${PORT}/ws`);
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`El puerto ${PORT} está ocupado.`);
  else console.error(error.message);
  process.exit(1);
});
