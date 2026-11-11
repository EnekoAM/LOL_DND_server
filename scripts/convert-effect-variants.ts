/**
 * Pasa efectos base a su variante por ítem (p. ej. spellblade → spellblade:magic en Perdición del liche).
 * Mapa JSON: { "<nombre>": { "<id actual (base o variante)>": "<id variante del mismo efecto>" } }.
 * Antes guarda la colección items en backups/<fecha>-<sufijo>/items.json (sufijo: 2º argumento o effect-variants).
 * Solo cambia namedEffects, y solo si el ítem tiene el id de origen (mantiene el orden y el resto de efectos).
 *   npx tsx scripts/convert-effect-variants.ts ruta/al/mapa.json [sufijo]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';

const VARIANT = /^[a-z0-9-]{1,60}:[a-z0-9-]{1,30}$/;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Falta la ruta del mapa JSON');
  const map = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
  const db = await getDb();
  const col = db.collection('items');

  const all = await col.find({}).toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = /^[a-z0-9-]{1,40}$/.test(process.argv[3] ?? '') ? process.argv[3] : 'effect-variants';
  const dir = join(process.cwd(), 'backups', `${stamp}-${suffix}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'items.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${join(dir, 'items.json')} (${all.length} ítems)`);

  let updated = 0;
  for (const [nombre, changes] of Object.entries(map)) {
    const item = all.find(entry => entry.nombre === nombre);
    if (!item) { console.log(`- ${nombre}: no está en la base`); continue; }
    const before: string[] = Array.isArray(item.namedEffects) ? item.namedEffects : [];
    const after = before.map(id => {
      const variant = changes[id];
      return variant && VARIANT.test(variant) && variant.startsWith(`${id.split(':')[0]}:`) ? variant : id;
    });
    const deduped = [...new Set(after)];
    if (deduped.join('|') === before.join('|')) { console.log(`- ${nombre}: sin cambios`); continue; }
    const result = await col.updateOne({ _id: item._id, namedEffects: before }, { $set: { namedEffects: deduped } });
    if (result.modifiedCount > 0) {
      updated += 1;
      console.log(`+ ${nombre}: ${before.join(', ')} → ${deduped.join(', ')}`);
    } else console.log(`! ${nombre}: cambió mientras tanto, no se toca`);
  }
  const bases = new Set(Object.values(map).flatMap(changes => Object.keys(changes)));
  const leftover = (await col.find({ namedEffects: { $in: [...bases] } }, { projection: { nombre: 1, namedEffects: 1 } }).toArray())
    .map(item => `${item.nombre} [${(item.namedEffects as string[]).filter(id => bases.has(id)).join(', ')}]`);
  console.log(`Actualizados: ${updated}`);
  if (leftover.length) console.log(`Con efecto base sin variante: ${leftover.join('; ')}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
