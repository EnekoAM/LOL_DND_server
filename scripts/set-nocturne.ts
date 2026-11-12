/**
 * Nocturne (Eneko): P AD 110/120/130/140% total por tramo 1/6/11/16; W velocidad de ataque aprendida 30–50%,
 * al usarla «Escudo de hechizos» 1 t. (rompible: ×2 durante 3 t.); R «Vista cercana» 3 t. a todos los enemigos. E sin cambios.
 * Copia champions en backups/<fecha>-nocturne/ antes.
 *   npx tsx scripts/set-nocturne.ts --dry   |   npx tsx scripts/set-nocturne.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

type Loose = Record<string, unknown>;

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Nocturne' });
  const a = doc?.abilities;
  if (!doc || !a?.P || !a.W || !a.R) throw new Error('Nocturne sin P/W/R');

  const P = { ...a.P, damage: { ...(a.P.damage as Loose), ad: [1.1, 1.2, 1.3, 1.4] } } as unknown as ChampionAbility;

  const wEffects = (Array.isArray((a.W as Loose).effect) ? ((a.W as Loose).effect as Loose[]) : []).filter(entry => !/velocidad de ataque/i.test(String(entry?.name ?? '')));
  const W = { ...a.W, effect: wEffects, mechanics: { ...(a.W.mechanics ?? {}), learnedStats: [{ stat: 'atkSpePct', values: [30, 35, 40, 45, 50] }], spellShield: { status: 'Escudo de hechizos', turns: 1, breakTurns: 3, learnedMultiplier: 2 } } } as Loose;
  delete W.effectDuration;
  delete W.effectTarget;

  const R = { ...a.R, effect: [{ name: 'Vista cercana', duration: [3] }], effectName: 'Vista cercana', effectTarget: 'enemy', effectDuration: 3, mechanics: { ...(a.R.mechanics ?? {}), allEnemies: true } } as unknown as ChampionAbility;

  const out: Record<string, ChampionAbility> = {};
  for (const [slot, ability] of [['P', P], ['W', W as unknown as ChampionAbility], ['R', R]] as const) {
    out[slot] = parseChampionAbilityPatch({ slot, ability }).ability;
    console.log(`${slot} antes: ${JSON.stringify(a[slot])}\n${slot} después: ${JSON.stringify(out[slot])}`);
  }
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-nocturne`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { 'abilities.P': out.P, 'abilities.W': out.W, 'abilities.R': out.R, updatedAt: new Date().toISOString() } });
  const after = (await col.findOne({ _id: doc._id }))?.abilities;
  console.log(`después: P ${JSON.stringify(after?.P?.damage)} · W ${JSON.stringify(after?.W?.mechanics)} · R ${JSON.stringify(after?.R?.mechanics)} ${after?.R?.effectDuration}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
