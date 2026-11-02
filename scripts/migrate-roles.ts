import type { Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';
import type { RoleStatLine } from '../src/validate';
import { DEFAULT_ROLE_TABLES, ROLE_MAX_LEVEL } from './roleDefaults';
import { extendLevels } from './roleExtend';

/**
 * Copia las tablas de rol × nivel (scripts/roleDefaults.ts) a la colección roles.
 * Un documento por rol: { _id: id, id, name, levels, order }.
 * Por defecto crea los roles que aún no existen y alarga hasta ROLE_MAX_LEVEL (20) los que
 * tienen menos niveles, sin tocar las filas ya guardadas: si coinciden con las por defecto se
 * añaden las filas por defecto; si se editaron a mano, se prolonga su propia progresión.
 * Con --force sobrescribe nombre y niveles de los ya guardados.
 */

/** Misma fila (sin depender del orden de las claves). */
const same = (a: RoleStatLine | undefined, b: RoleStatLine | undefined) => {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => a[key as keyof RoleStatLine] === b[key as keyof RoleStatLine]);
};

/** Filas que faltan para llegar a ROLE_MAX_LEVEL en un rol ya guardado. */
function missingLevels(stored: RoleStatLine[], defaults: RoleStatLine[]): RoleStatLine[] {
  if (stored.length >= ROLE_MAX_LEVEL) return [];
  const untouched = stored.every((line, index) => same(line, defaults[index]));
  const full = untouched ? defaults : extendLevels(stored, ROLE_MAX_LEVEL);
  return full.slice(stored.length, ROLE_MAX_LEVEL);
}

async function migrate() {
  const force = process.argv.includes('--force');
  const db = await getDb();
  const roles = db.collection<Document & { _id: string }>('roles');

  let written = 0;
  for (const [order, role] of DEFAULT_ROLE_TABLES.entries()) {
    const doc = { id: role.id, name: role.name, levels: role.levels, order };
    const updatedAt = new Date().toISOString();
    const result = force
      ? await roles.updateOne({ _id: role.id }, { $set: { ...doc, updatedAt } }, { upsert: true })
      : await roles.updateOne({ _id: role.id }, { $setOnInsert: { ...doc, updatedAt } }, { upsert: true });
    if (result.upsertedCount || result.modifiedCount) {
      written += 1;
      console.log(`${role.name}: ${role.levels.length} niveles guardados`);
    } else {
      const stored = await roles.findOne({ _id: role.id });
      const levels = Array.isArray(stored?.levels) ? (stored.levels as RoleStatLine[]) : [];
      const extra = missingLevels(levels, role.levels);
      if (extra.length > 0) {
        await roles.updateOne(
          { _id: role.id, levels: { $size: levels.length } },
          { $set: { levels: [...levels, ...extra], updatedAt } },
        );
        written += 1;
        console.log(`${role.name}: ${levels.length} → ${levels.length + extra.length} niveles`);
      } else {
        console.log(`${role.name}: ya existía con ${levels.length} niveles (usa --force para sobrescribir)`);
      }
    }
  }
  const total = await roles.countDocuments();
  console.log(`Base "${db.databaseName}": ${written} roles escritos, ${total} en la colección roles.`);
}

loadEnv();
migrate()
  .catch(error => {
    logError(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
