/**
 * Flujo de maná (Eneko): las cargas de combate se gastan como mucho 1 por turno → charges.perTurn en manaflow (y mejoras manaflow:*).
 * Copia namedEffectDescriptions en backups/<fecha>-manaflow-per-turn/ antes.
 *   npx tsx scripts/manaflow-per-turn.ts --dry   |   npx tsx scripts/manaflow-per-turn.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: string; bonus?: { charges?: Record<string, unknown> } }>('namedEffectDescriptions');
  const docs = (await col.find({ _id: { $regex: /^manaflow(:|$)/ } }).toArray()).filter(doc => doc.bonus?.charges);
  const updates = docs.map(doc => ({ id: doc._id, before: doc.bonus, bonus: parseEffectBonusConfig({ ...doc.bonus, charges: { ...doc.bonus!.charges, perTurn: true } }) }));
  for (const update of updates) console.log(`${update.id}: charges ${JSON.stringify(update.before?.charges)} → ${JSON.stringify(update.bonus.charges)}`);
  if (dry || !updates.length) { console.log(dry ? '[dry] nada escrito' : 'nada que cambiar'); process.exit(0); }
  const all = await col.find({}).toArray();
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-manaflow-per-turn`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} docs)`);
  for (const update of updates) await col.updateOne({ _id: update.id }, { $set: { bonus: update.bonus, updatedAt: new Date().toISOString() } });
  console.log('hecho');
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
