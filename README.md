# LOL_DND · servidor

API de LOL_DND: Express + MongoDB (Atlas) + sync en vivo (Ably o WebSocket local).

## Estructura

```
src/
  index.ts        # entrada Express (rutas /api/*, CORS, WebSocket /ws)
  api/            # handlers de cada ruta
  handlers/       # handlers de un jugador / un rol
  db.ts store.ts validate.ts live.ts livePublish.ts ...
scripts/          # seed y migraciones de Mongo (npm run seed, migrate:*)
```

## Local

```
npm install
copy .env.example .env    # y rellena MONGODB_URI, etc.
npm run dev               # http://localhost:3001 (se reinicia al guardar)
```

La web (`../web`) arranca con `npm run dev` y su proxy de Vite manda `/api` y `/ws` a `localhost:3001`.
Desde `web` también puedes arrancar esta API con `npm run dev:api`.

Comprobar tipos: `npm run typecheck`.

## Render

Crea un **Web Service** conectado a este repo:

- **Root Directory**: (vacío, la raíz del repo)
- **Runtime**: Node (20 o superior)
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/api/health`

Variables de entorno (Environment):

| Variable | Obligatoria | Para qué |
|---|---|---|
| `MONGODB_URI` | sí | Cadena de MongoDB Atlas |
| `MONGODB_DB` | no | Nombre de la base (por defecto el de la URI o `lol`) |
| `API_WRITE_KEY` | no | Si tiene valor, las escrituras piden la cabecera `x-api-key` |
| `ABLY_API_KEY` | recomendada | Sync en vivo entre navegadores |
| `ABLY_CHANNEL` | no | Canal de Ably (por defecto `lol-dnd`) |
| `CORS_ORIGIN` | no | Orígenes permitidos separados por comas (vacío = cualquiera) |

`PORT` lo pone Render solo. No subas nunca el `.env`.

En MongoDB Atlas → Network Access, permite las IPs de Render (o `0.0.0.0/0`).

Notas:

- En el plan Free de Render el servicio se duerme tras 15 min sin tráfico; la primera petición tarda ~1 min.
- Para la sync en vivo con el frontend en otro dominio usa **Ably** (`ABLY_API_KEY`):
  el WebSocket `/ws` solo sirve cuando el navegador conecta directo a esta API.
- Frontend en Vercel: lo más simple es un rewrite en `vercel.json` de la web
  (`/api/:path*` → `https://TU-SERVICIO.onrender.com/api/:path*`), así no hace falta tocar el código ni CORS.