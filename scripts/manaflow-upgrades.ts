/**
 * Pedido de Eneko (12-11-2026): Muramana y Abrazo del serafín también llevan Flujo de maná (manaflow), para que las
 * cargas permanentes compartidas (effect:manaflow) sigan sumando tras la mejora. Y Samael: si effect:manaflow = 30,
 * borra su contador viejo item:Lagrima de la Diosa. Copia items y players en backups/<fecha>-manaflow-upgrades/ antes.
 *   npx tsx scripts/manaflow-upgrades.ts --dry   |   npx tsx scripts/manaflow-upgrades.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';

const ITEMS = ['Muramana', 'Abrazo del serafin'];
const PLAYER = 'Samael';
const OLD = 'item:Lagrima de la Diosa';

async function main() {
  const dry = process.argv.includes('--dry');
  const p = dry ? '[dry] ' : '';
  const db = await getDb();
  const items = db.collection('items');
  const players = db.collection('players');
  if (!dry) {
    const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-manaflow-upgrades`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['items', 'players']) writeFileSync(join(dir, `${name}.json`), JSON.stringify(await db.collection(name).find({}).toArray(), null, 2), 'utf8');
    console.log(`Copia: ${dir}`);
  }
  const now = new Date().toISOString();
  for (const nombre of ITEMS) {
    const item = await items.findOne({ nombre });
    if (!item) { console.log(`¡${nombre} no encontrado!`); continue; }
    const list = (item.namedEffects ?? []) as string[];
    if (list.includes('manaflow')) { console.log(`${nombre}: ya tiene manaflow`); continue; }
    const next = [...list, 'manaflow'];
    console.log(`${p}${nombre}: namedEffects ${JSON.stringify(list)} → ${JSON.stringify(next)}`);
    if (!dry) await items.updateOne({ _id: item._id }, { $set: { namedEffects: next, updatedAt: now } });
  }
  const player = await players.findOne({ name: PLAYER });
  const stacks = (player?.stacks ?? {}) as Record<string, number>;
  console.log(`${PLAYER}: effect:manaflow = ${stacks['effect:manaflow']} · ${OLD} = ${stacks[OLD]}`);
  if (player && stacks['effect:manaflow'] === 30 && OLD in stacks) {
    console.log(`${p}${PLAYER}: borra ${OLD}`);
    if (!dry) {
      await players.updateOne({ _id: player._id }, { $unset: { [`stacks.${OLD}`]: '' } });
      console.log(`  después ${JSON.stringify((await players.findOne({ _id: player._id }))?.stacks)}`);
    }
  } else console.log(`${PLAYER}: no se borra nada (effect:manaflow no es 30 o ${OLD} ya no está)`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
