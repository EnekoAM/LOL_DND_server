import { timingSafeEqual } from 'node:crypto';
import { loadEnv } from './env';
import { HttpError, logError } from './errors';

export type ApiQuery = Record<string, string | string[] | undefined>;

export type ApiRequest = {
  method?: string;
  query?: ApiQuery;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

export function queryValue(query: ApiQuery | undefined, key: string): string | undefined {
  const value = query?.[key];
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value;
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Si API_WRITE_KEY está vacío, las escrituras quedan abiertas. */
export function assertWriteAccess(req: ApiRequest): void {
  loadEnv();
  const expected = process.env.API_WRITE_KEY?.trim();
  if (!expected) return;
  const header = req.headers?.['x-api-key'];
  const got = Array.isArray(header) ? header[0] : header;
  if (!got || !safeEqual(got, expected)) throw new HttpError(401, 'Falta una API key válida');
}

export function withErrors(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status >= 500) logError(error);
        res.status(error.status).json({ error: error.message });
        return;
      }
      logError(error);
      res.status(500).json({ error: 'Error interno' });
    }
  };
}
