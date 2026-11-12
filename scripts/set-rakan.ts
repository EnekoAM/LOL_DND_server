/**
 * Rakan desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango), sin base plana,
 * 200 u/casilla, coste ÷2 (↑), duraciones s÷2 (↑, mín. 1), sin CD. P por tramos 1/6/11/16 (2.º = wiki, ±10).
 * Solo rellena huecos vacíos (no pisa lo puesto a mano). Copia champions en backups/<fecha>-rakan/ antes.
 *   npx tsx scripts/set-rakan.ts --dry   |   npx tsx scripts/set-rakan.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

const ring = (cx: number, cy: number, r: number, skipCenter: boolean): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (!(skipCenter && x === cx && y === cy)) out.push([x, y]);
  return out;
};

const ABILITIES: Record<string, unknown> = {
  P: {
    name: 'Fey Feathers',
    description: 'Escudo propio (% AP según nivel) que dura hasta romperse. Se recarga con el tiempo; cada campeón enemigo alcanzado con AA o habilidad acelera la recarga.',
    learned: true,
    mechanics: {
      charges: { start: 1, max: 1, recharge: [20, 16, 12, 8], reducePerChampionHit: 1 },
      castPool: { kind: 'shield', ratios: [{ stat: 'ap', values: [85, 95, 105, 115] }] },
      noAction: true,
    },
  },
  Q: {
    name: 'Gleaming Quill',
    description: 'Lanza una pluma que hace daño mágico al primer enemigo. Si alcanza a un enemigo, Rakan se cura (y a los aliados cercanos que elijas).',
    learned: true,
    cost: '23',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.6, 0.65, 0.7, 0.75, 0.8] },
    area: { size: 11, user: [5, 5], target: null, tiles: [[5, 4], [5, 3], [5, 2], [5, 1], [5, 0]] },
    mechanics: { castPool: { kind: 'heal', ratios: [{ stat: 'ap', values: [45, 50, 55, 60, 65] }], requiresHit: true, alliesToo: true } },
  },
  W: {
    name: 'Grand Entrance',
    description: 'Salta a una zona y, tras un instante, hace daño mágico y lanza por los aires a los enemigos cercanos.',
    learned: true,
    cost: '25/30/35/40/45',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.7, 0.75, 0.8, 0.85, 0.9] },
    effect: [{ name: 'Lanzado por los aires', duration: [1] }],
    effectTarget: 'enemy',
    effectName: 'Lanzado por los aires',
    effectDuration: 1,
    area: { size: 9, user: [4, 4], target: [4, 1], tiles: ring(4, 1, 1, false) },
  },
  E: {
    name: 'Battle Dance',
    description: 'Da un escudo a un aliado y salta hacia él. Se puede volver a lanzar una vez gratis.',
    learned: true,
    cost: '20/23/25/28/30',
    resource: 'mana',
    area: { size: 9, user: [4, 4], target: [4, 0], tiles: [[4, 0]] },
    mechanics: {
      castPool: { kind: 'shield', ratios: [{ stat: 'ap', values: [60, 65, 70, 75, 80] }], turns: 2, target: 'ally' },
      recast: { times: 1, turns: 3 },
    },
  },
  R: {
    name: 'The Quickness',
    description: 'Corre a toda velocidad (fantasmal, +75% vel. movimiento): daña y encanta a los enemigos que toca.',
    learned: true,
    cost: '50',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.5, 0.6, 0.7] },
    effect: [{ name: 'Encantado', duration: [1, 1, 1] }],
    effectTarget: 'enemy',
    effectName: 'Encantado',
    effectDuration: 1,
    area: { size: 5, user: [2, 2], target: null, tiles: ring(2, 2, 1, true) },
    mechanics: { selfStatus: { name: 'Fantasmal (+% vel. movimiento)', turns: 2, value: 75 } },
  },
};

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Rakan' });
  if (!doc) throw new Error('Rakan no está en la base');
  const set: Record<string, unknown> = {};
  for (const [slot, ability] of Object.entries(ABILITIES)) {
    const existing = doc.abilities?.[slot];
    if (existing?.name) { console.log(`${slot}: ya tiene «${existing.name}» (a mano) → NO se toca. Conflicto: ${JSON.stringify(existing)}`); continue; }
    const parsed = parseChampionAbilityPatch({ slot, ability: ability as ChampionAbility }).ability;
    set[`abilities.${slot}`] = parsed;
    console.log(`${slot}: ${JSON.stringify(parsed)}`);
  }
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  if (!Object.keys(set).length) { console.log('Nada que escribir'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-rakan`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { ...set, updatedAt: new Date().toISOString() } });
  console.log(`después: ${Object.keys((await col.findOne({ _id: doc._id }))?.abilities ?? {}).join(', ')}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
