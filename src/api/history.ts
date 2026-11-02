import { HttpError } from '../errors';
import { assertWriteAccess, withErrors } from '../http';
import { listHistory, revertHistory } from '../store';
import { parseHistoryRevert, parseHistoryRevertBatch } from '../validate';
import { withLive } from '../livePublish';

type BatchResult = { id: string; kind: string; ok: boolean; error?: string };

export default withLive({ POST: ['items', 'party', 'history'] }, withErrors(async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json(await listHistory());
    return;
  }
  if (req.method === 'POST') {
    assertWriteAccess(req);
    const body: unknown = req.body;
    if (body && typeof body === 'object' && 'entries' in body) {
      // Varias entradas a la vez: se revierten una a una, en el orden recibido.
      const entries = parseHistoryRevertBatch(body);
      const results: BatchResult[] = [];
      const items = new Map<string, unknown>();
      let gold: number | undefined;
      for (const { id, kind } of entries) {
        try {
          const saved = await revertHistory(kind, id);
          for (const item of saved.items) items.set(String(item.nombre ?? item._id), item);
          gold = saved.gold;
          results.push({ id, kind, ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo revertir';
          results.push({ id, kind, ok: false, error: message });
        }
      }
      res.status(200).json({ results, items: [...items.values()], gold });
      return;
    }
    const { id, kind } = parseHistoryRevert(body);
    res.status(200).json(await revertHistory(kind, id));
    return;
  }
  throw new HttpError(405, 'Método no permitido');
}));
