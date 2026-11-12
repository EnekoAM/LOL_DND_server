/**
 * Jarvan IV P Cadencia marcial (Eneko): CD por objetivo por nivel 3/3/2/2 (niveles 1–5 / 6–10 / 11–15 / 16–20).
 * Copia champions en backups/<fecha>-jarvan-p-cd-level/ antes.
 *   npx tsx scripts/set-jarvan-p-cd-level.ts --dry   |   npx tsx scripts/set-jarvan-p-cd-level.ts
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
  const doc = await col.findOne({ champion: 'Jarvan IV' });
  const before = doc?.abilities?.P;
  const rules = before?.mechanics?.effectRules;
  if (!doc || !before || !rules) throw new Error('Jarvan IV P sin reglas de efecto');
  const next: ChampionAbility = { ...before, mechanics: { ...before.mechanics, effectRules: { ...rules, cooldownByLevel: [3, 3, 2, 2] } } };
  const parsed = parseChampionAbilityPatch({ slot: 'P', ability: next }).ability;
  console.log(`P «${before.name}»: effectRules ${JSON.stringify(rules)} → ${JSON.stringify(parsed.mechanics?.effectRules)}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-jarvan-p-cd-level`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { 'abilities.P': parsed, updatedAt: new Date().toISOString() } });
  console.log(`después P: ${JSON.stringify((await col.findOne({ _id: doc._id }))?.abilities?.P)}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
