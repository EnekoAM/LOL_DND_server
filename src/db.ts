import { MongoClient, type Db } from 'mongodb';
import { loadEnv } from './env';
import { HttpError, logError } from './errors';

const INDEXED = ['champions', 'items', 'players', 'roles'] as const;

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

function databaseName(client: MongoClient): string {
  const fromEnv = process.env.MONGODB_DB?.trim();
  if (fromEnv) return fromEnv;
  const fromUri = client.options.dbName?.trim();
  return fromUri || 'lol';
}

async function ensureIndexes(db: Db): Promise<void> {
  indexesPromise ??= Promise.all(
    INDEXED.map(name => db.collection(name).createIndex({ order: 1 })),
  )
    .then(() => undefined)
    .catch(error => {
      indexesPromise = undefined;
      throw error;
    });
  await indexesPromise;
}

export async function getDb(): Promise<Db> {
  loadEnv();
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new HttpError(503, 'Falta MONGODB_URI en el servidor');

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      appName: 'lol',
    });
    clientPromise = client.connect().catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }

  try {
    const client = await clientPromise;
    const db = client.db(databaseName(client));
    await ensureIndexes(db);
    return db;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logError(error);
    clientPromise = undefined;
    indexesPromise = undefined;
    throw new HttpError(503, 'No se pudo conectar con MongoDB');
  }
}

export async function closeDb(): Promise<void> {
  const pending = clientPromise;
  clientPromise = undefined;
  indexesPromise = undefined;
  if (!pending) return;
  const client = await pending.catch(() => undefined);
  await client?.close();
}
