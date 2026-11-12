/**
 * Ashe P (Eneko, «como el LoL»): los críticos no hacen daño extra y duplican la ralentización de la pasiva.
 * Fusiona en abilities.P.mechanics. Copia champions en backups/<fecha>-ashe-p-crit/ antes.
 *   npx tsx scripts/set-ashe-p-crit.ts --dry   |   npx tsx scripts/set-ashe-p-crit.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Ashe' });
  const before = doc?.abilities?.P;
  if (!doc || !before) throw new Error('Ashe P no existe');
  const next: ChampionAbility = { ...before, mechanics: { ...before.mechanics, critNoDamage: true, critDoublesPassive: true } };
  const parsed = parseChampionAbilityPatch({ slot: 'P', ability: next }).ability;
  console.log(`P «${before.name}»: mechanics ${JSON.stringify(before.mechanics)} → ${JSON.stringify(parsed.mechanics)}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ashe-p-crit`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { 'abilities.P': parsed, updatedAt: new Date().toISOString() } });
  const after = await col.findOne({ _id: doc._id });
  console.log(`después P: ${JSON.stringify(after?.abilities?.P)}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
