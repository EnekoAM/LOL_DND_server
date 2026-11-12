/**
 * Quita de Ashe Q el efecto «Velocidad de ataque» (20–60 %) que puso el script de la wiki: el buff de activación
 * (mechanics.buff.attackSpeed) lo sustituye y contaría doble. Copia champions en backups/<fecha>-ashe-q-effect/ antes.
 *   npx tsx scripts/remove-ashe-q-effect.ts --dry   |   npx tsx scripts/remove-ashe-q-effect.ts
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
  const before = doc?.abilities?.Q;
  if (!doc || !before) throw new Error('Ashe Q no existe');
  const effects = before.effect ?? [];
  const kept = effects.filter(effect => effect.name !== 'Velocidad de ataque');
  if (kept.length === effects.length) { console.log('Nada que quitar'); process.exit(0); }
  const next: ChampionAbility = { ...before, effect: kept };
  if (!kept.length) delete next.effect;
  const parsed = parseChampionAbilityPatch({ slot: 'Q', ability: next }).ability;
  console.log(`Q «${before.name}»: quita ${JSON.stringify(effects.filter(effect => !kept.includes(effect)))}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ashe-q-effect`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { 'abilities.Q': parsed, updatedAt: new Date().toISOString() } });
  const after = await col.findOne({ _id: doc._id });
  console.log(`después Q: ${JSON.stringify(after?.abilities?.Q)}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
