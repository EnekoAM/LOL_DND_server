/**
 * Rakan, correcciones de Eneko (pisa lo anterior): P escudo automático con CD 20/16/13/9 (−0,5 por enemigo alcanzado),
 * 6/15,6/28,8/45 + 85/90/95/100% AP; Q cura retrasada 2 t. en 3×3 (8/18/28/38 por tramo + 45–65% AP); W «Levantado»;
 * E escudo 10–30 + 60–80% AP 2 t., recast 3 t. sin maná (sí gasta acción); R 40/50/60% AP.
 * Copia champions en backups/<fecha>-rakan-fix/ antes.
 *   npx tsx scripts/set-rakan-fix.ts --dry   |   npx tsx scripts/set-rakan-fix.ts
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
  const doc = await col.findOne({ champion: 'Rakan' });
  const a = doc?.abilities as Record<string, Loose> | undefined;
  if (!doc || !a?.P || !a.Q || !a.W || !a.E || !a.R) throw new Error('Rakan sin P/Q/W/E/R');

  const P: Loose = {
    ...a.P,
    description: 'Empieza el combate con un escudo (base + % AP según nivel) que dura hasta romperse. Al romperse entra en CD; al acabar vuelve solo. Cada enemigo alcanzado con AA o habilidad quita 0,5 t. de CD.',
    mechanics: { innateShield: { flat: [6, 15.6, 28.8, 45], ratios: [{ stat: 'ap', values: [85, 90, 95, 100] }], cooldown: [20, 16, 13, 9], reducePerHit: 0.5 } },
  };
  const ring = (cx: number, cy: number): [number, number][] => [[cx - 1, cy - 1], [cx, cy - 1], [cx + 1, cy - 1], [cx - 1, cy], [cx + 1, cy], [cx - 1, cy + 1], [cx, cy + 1], [cx + 1, cy + 1]];
  const Q: Loose = {
    ...a.Q,
    description: 'Lanza una pluma que hace daño mágico al primer enemigo. Si impacta, cura a Rakan y a los aliados del 3×3 a su alrededor tras 2 turnos (o al activarlo a mano).',
    damage: { type: 'magic', ap: [0.6, 0.65, 0.7, 0.75, 0.8] },
    area: { size: 11, user: [5, 5], target: null, tiles: [...ring(5, 5), [5, 3], [5, 2], [5, 1], [5, 0]] },
    mechanics: { castPool: { kind: 'heal', flat: [8, 18, 28, 38], flatByLevel: true, ratios: [{ stat: 'ap', values: [45, 50, 55, 60, 65] }], requiresHit: true, alliesToo: true, delayTurns: 2 } },
  };
  const W: Loose = { ...a.W, description: 'Salta a una zona y, tras un instante, hace daño mágico y levanta a los enemigos cercanos.', effect: [{ name: 'Levantado', duration: [1] }], effectName: 'Levantado' };
  const E: Loose = {
    ...a.E,
    description: 'Da un escudo a un aliado (2 t.) y salta hacia él. Puede volver a lanzarla durante 3 t. sin coste de maná (sí gasta la acción).',
    mechanics: { castPool: { kind: 'shield', flat: [10, 15, 20, 25, 30], ratios: [{ stat: 'ap', values: [60, 65, 70, 75, 80] }], turns: 2, target: 'ally' }, recast: { times: 1, turns: 3 } },
  };
  const R: Loose = { ...a.R, damage: { type: 'magic', ap: [0.4, 0.5, 0.6] } };

  const out: Record<string, ChampionAbility> = {};
  for (const [slot, ability] of Object.entries({ P, Q, W, E, R })) {
    out[slot] = parseChampionAbilityPatch({ slot, ability: ability as unknown as ChampionAbility }).ability;
    console.log(`${slot} antes: ${JSON.stringify(a[slot])}\n${slot} después: ${JSON.stringify(out[slot])}`);
  }
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-rakan-fix`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const [slot, ability] of Object.entries(out)) set[`abilities.${slot}`] = ability;
  await col.updateOne({ _id: doc._id }, { $set: set });
  console.log(`después: ${JSON.stringify((await col.findOne({ _id: doc._id }))?.abilities?.P?.mechanics)}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
