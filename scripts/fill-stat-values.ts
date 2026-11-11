/**
 * Rellena stats de ítems a partir de un JSON { "<clave de stat>": { "<nombre>": valor } }.
 * Antes guarda la colección items en backups/<fecha>-new-stat-values/items.json.
 * Solo pone stats.<clave> si el ítem no la tiene o vale 0 (no pisa valores ya puestos). No toca nada más.
 *   npx tsx scripts/fill-stat-values.ts ruta/al/mapa.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';

const ALLOWED = new Set(['Heal & shield %', 'Tenacity %', 'Slow resist %', 'Life steal %', 'Omnivamp %', 'Range', 'HP regen', 'Mana regen']);

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Falta la ruta del mapa JSON');
  const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, number>>;
  const db = await getDb();
  const col = db.collection('items');

  const all = await col.find({}).toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `${stamp}-new-stat-values`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'items.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${join(dir, 'items.json')} (${all.length} ítems)`);

  for (const [stat, values] of Object.entries(map)) {
    if (!ALLOWED.has(stat)) throw new Error(`Stat no permitida: ${stat}`);
    let updated = 0;
    const skipped: string[] = [];
    for (const [nombre, value] of Object.entries(values)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${nombre}: valor no válido`);
      const item = all.find(entry => entry.nombre === nombre);
      if (!item) { skipped.push(`${nombre} (no está)`); continue; }
      const current = (item.stats as Record<string, unknown> | undefined)?.[stat];
      if (current !== undefined && current !== 0 && current !== '' && current !== '0') { skipped.push(`${nombre} (ya tiene ${String(current)})`); continue; }
      const result = await col.updateOne({ _id: item._id }, { $set: { [`stats.${stat}`]: value } });
      if (result.modifiedCount > 0) updated += 1;
    }
    console.log(`${stat}: ${updated} ítems${skipped.length ? ` · sin tocar: ${skipped.join(', ')}` : ''}`);
  }
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
