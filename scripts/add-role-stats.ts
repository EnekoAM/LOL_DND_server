import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BSON, type Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';

/**
 * Añade a todas las filas (niveles) de las tablas de rol las stats que solo dan los ítems, con valor 0:
 *   healShieldPct, tenacityPct, slowResistPct, lifeStealPct, omnivampPct, range, healthRegen, manaRegen.
 * Antes guarda la colección roles en backups/<fecha>-<sufijo>/roles.json (EJSON); sufijo = argumento o «new-stats».
 * Solo toca `levels` y solo añade claves que falten (no cambia valores). Idempotente.
 *   npx tsx scripts/add-role-stats.ts
 */
const NEW_KEYS = ['healShieldPct', 'tenacityPct', 'slowResistPct', 'lifeStealPct', 'omnivampPct', 'range', 'healthRegen', 'manaRegen'] as const;

async function main() {
  const db = await getDb();
  const roles = db.collection<Document>('roles');
  const all = await roles.find({}).toArray();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = /^[a-z0-9-]{1,40}$/.test(process.argv[2] ?? '') ? process.argv[2] : 'new-stats';
  const dir = join(process.cwd(), 'backups', `${stamp}-${suffix}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'roles.json'), BSON.EJSON.stringify(all, undefined, 2, { relaxed: false }), 'utf8');
  console.log(`Copia: ${join(dir, 'roles.json')} (${all.length} roles)`);

  let updated = 0;
  for (const role of all) {
    const levels = Array.isArray(role.levels) ? (role.levels as Document[]) : [];
    let changed = false;
    const next = levels.map(level => {
      const row = { ...level };
      for (const key of NEW_KEYS) {
        if (!(key in row)) {
          row[key] = 0;
          changed = true;
        }
      }
      return row;
    });
    if (!changed) continue;
    await roles.updateOne({ _id: role._id }, { $set: { levels: next } });
    updated += 1;
    console.log(`+ ${String(role._id)}: ${levels.length} niveles`);
  }
  console.log(`Roles actualizados: ${updated}`);
  await closeDb();
}

main().catch(async error => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
