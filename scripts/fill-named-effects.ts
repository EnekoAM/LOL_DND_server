/**
 * Añade efectos con nombre (namedEffects) a ítems de la base a partir de un JSON { "<nombre>": ["id", ...] }.
 * Antes guarda una copia de la colección items en backups/<fecha>-named-effects/items.json.
 * Solo usa $addToSet sobre namedEffects: nunca quita valores ni toca otros campos.
 *   npx tsx scripts/fill-named-effects.ts ruta/al/mapa.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';

const ID = /^[a-z0-9-]{1,60}$/;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Falta la ruta del mapa JSON');
  const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>;
  const db = await getDb();
  const col = db.collection('items');

  const all = await col.find({}).toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `${stamp}-named-effects`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'items.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${join(dir, 'items.json')} (${all.length} ítems)`);

  let updated = 0;
  const missing: string[] = [];
  for (const [nombre, ids] of Object.entries(map)) {
    const clean = ids.filter(id => ID.test(id));
    if (clean.length === 0) continue;
    const result = await col.updateOne({ nombre }, { $addToSet: { namedEffects: { $each: clean } } });
    if (result.matchedCount === 0) missing.push(nombre);
    else if (result.modifiedCount > 0) updated += 1;
  }
  console.log(`Actualizados: ${updated}`);
  if (missing.length) console.log(`Sin coincidencia en la base: ${missing.join(', ')}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
