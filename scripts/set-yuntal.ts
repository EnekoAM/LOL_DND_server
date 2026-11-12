/**
 * Flechas de los Yun Tal — «Practice Makes Lethal» (lo dio Eneko): cada AA da 1 carga permanente, máx. 25,
 * cada carga +0,2 de prob. de crítico (caras de d20). Copia namedEffectDescriptions en backups/<fecha>-yuntal/ antes.
 *   npx tsx scripts/set-yuntal.ts --dry   |   npx tsx scripts/set-yuntal.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

const ID = 'practice-makes-lethal';
const DESCRIPTION = 'Los auto-ataques otorgan 1 carga permanente (máx. 25); cada carga da +0,2 de probabilidad de crítico (caras de d20: 25 cargas = +5).';
const BONUS = { rules: [{ trigger: 'on-attack', kind: 'stat', stat: 'critChance', flat: 0.2, maxStacks: 25, permanent: true, appliesTo: 'self' }] };

type Doc = { _id: string; bonus?: unknown; description?: string; updatedAt?: string };

async function main() {
  const dry = process.argv.includes('--dry');
  const bonus = parseEffectBonusConfig(BONUS);
  const db = await getDb();
  const col = db.collection<Doc>('namedEffectDescriptions');
  const doc = await col.findOne({ _id: ID });
  console.log(`antes: ${JSON.stringify(doc)}`);
  console.log(`${dry ? '[dry] ' : ''}${ID}: bonus → ${JSON.stringify(bonus)}${doc?.description?.trim() ? ' · descripción suya: no se toca' : ' · descripción nueva'}`);
  if (dry) process.exit(0);
  const all = await col.find({}).toArray();
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-yuntal`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} docs)`);
  await col.updateOne({ _id: ID }, { $set: { bonus, ...(doc?.description?.trim() ? {} : { description: DESCRIPTION }), updatedAt: new Date().toISOString() } }, { upsert: true });
  console.log(`después: ${JSON.stringify(await col.findOne({ _id: ID }))}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
