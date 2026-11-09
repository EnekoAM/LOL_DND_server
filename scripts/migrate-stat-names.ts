import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BSON, type Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';

/**
 * Renombra las stats de velocidad en toda la base (claves y textos):
 *   AB_SPE_PCT / AB_SPE_%   -> "Ab haste"
 *   ATK_SPE_PCT / ATK_SPE_% -> "ATK spe"
 *   ATK_SPE                 -> "Attacks"
 *   AB_SPE                  -> "Abilities"
 * Antes de tocar nada guarda una copia JSON (EJSON) de cada coleccion afectada en backups/<fecha>/.
 * Idempotente: si ya no quedan nombres antiguos no cambia nada.
 */
const RENAMES: [RegExp, string][] = [
  [/(?<![A-Za-z0-9_])AB_SPE_(?:PCT|%)(?![A-Za-z0-9_%])/g, 'Ab haste'],
  [/(?<![A-Za-z0-9_])ATK_SPE_(?:PCT|%)(?![A-Za-z0-9_%])/g, 'ATK spe'],
  [/(?<![A-Za-z0-9_])ATK_SPE(?![A-Za-z0-9_%])/g, 'Attacks'],
  [/(?<![A-Za-z0-9_])AB_SPE(?![A-Za-z0-9_%])/g, 'Abilities'],
];
const OLD = /AB_SPE|ATK_SPE/;

const rename = (text: string): string => RENAMES.reduce((out, [re, to]) => out.replace(re, to), text);

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** Copia el valor cambiando claves y textos; mantiene el orden de las claves. */
function transform(value: unknown): unknown {
  if (typeof value === 'string') return rename(value);
  if (Array.isArray(value)) return value.map(transform);
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      const next = rename(key);
      // Si conviven la clave vieja y la nueva (una pestana con la web antigua edito despues de migrar),
      // manda el valor de la vieja, que es el ultimo que se guardo; la posicion es la de la primera que aparezca.
      if (next === key && Object.prototype.hasOwnProperty.call(out, next)) continue;
      out[next] = transform(inner);
    }
    return out;
  }
  return value;
}

async function migrate() {
  loadEnv();
  const db = await getDb();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(process.cwd(), 'backups', stamp);
  const collections = (await db.listCollections().toArray()).map(c => c.name).sort();

  const affected: { name: string; docs: Document[] }[] = [];
  for (const name of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const hits = docs.filter(doc => OLD.test(JSON.stringify(doc)));
    if (hits.length) affected.push({ name, docs });
  }

  if (!affected.length) {
    console.log('No quedan nombres antiguos. Nada que hacer.');
    return;
  }

  mkdirSync(backupDir, { recursive: true });
  for (const { name, docs } of affected) {
    writeFileSync(join(backupDir, `${name}.json`), BSON.EJSON.stringify(docs, undefined, 2, { relaxed: false }), 'utf8');
  }
  console.log(`Copia guardada en ${backupDir}`);

  for (const { name, docs } of affected) {
    const col = db.collection(name);
    let changed = 0;
    for (const doc of docs) {
      if (!OLD.test(JSON.stringify(doc))) continue;
      const { _id, ...rest } = doc;
      const next = transform(rest) as Document;
      const res = await col.replaceOne({ _id }, next);
      changed += res.modifiedCount;
    }
    const left = (await col.find({}).toArray()).filter(doc => OLD.test(JSON.stringify(doc))).length;
    console.log(`${name}: ${docs.length} docs, ${changed} cambiados, ${left} con nombres antiguos`);
  }
}

migrate()
  .catch(error => {
    logError(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
