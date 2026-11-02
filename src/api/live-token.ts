import { HttpError } from '../errors';
import { withErrors } from '../http';
import { ablyChannelName, ablyRest } from '../livePublish';

/**
 * Token corto de Ably para el navegador (solo puede suscribirse al canal).
 * La ABLY_API_KEY completa nunca sale del servidor.
 * Sin key responde { enabled: false } y el cliente usa el WebSocket local (o nada).
 */
export default withErrors(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método no permitido');
  const client = ablyRest();
  if (!client) {
    res.status(200).json({ enabled: false });
    return;
  }
  const channel = ablyChannelName();
  const tokenRequest = await client.auth.createTokenRequest({
    capability: { [channel]: ['subscribe'] },
    ttl: 60 * 60 * 1000,
  });
  res.status(200).json({ enabled: true, channel, tokenRequest });
});
