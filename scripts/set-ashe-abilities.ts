/**
 * Ashe según Eneko (mecánicas de combate de habilidad):
 *  P Tiro Congelante: AA con daño extra por prob. de crítico (valor sin dar → 0); su ralentización es el estado aplicable.
 *  Q Concentración: 1 carga por efecto de impacto (2 t., se refresca, máx. 4); con 4 se activa (las gasta);
 *    3 t.: +20/30/40/50/60 % vel. ataque, AA al 110/115/120/125/130 % AD y aplican la ralentización de la P.
 *  W Ráfaga de flechas: aplica la ralentización de la P.
 *  E Descenso del halcón: 2 cargas al empezar el combate; recarga 1 cada 45/40/35/30/25 t. según rango.
 * Solo toca lo que su especificación sustituye. Copia champions en backups/<fecha>-ashe-abilities/ antes.
 *   npx tsx scripts/set-ashe-abilities.ts --dry   |   npx tsx scripts/set-ashe-abilities.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility, type ChampionAbilityMechanics } from '../src/validate';

type Slot = 'P' | 'Q' | 'W' | 'E';
/** set = campos que se ponen (mechanics se fusiona); unset = campos que su especificación sustituye. */
const CHANGES: Record<Slot, { mechanics: ChampionAbilityMechanics; unset?: (keyof ChampionAbility)[]; why?: string }> = {
  P: { mechanics: { aaCritBonus: { pctPerFace: 0 } } },
  Q: {
    mechanics: {
      stacks: { turns: 2, max: 4, required: 4 },
      buff: { turns: 3, attackSpeed: [20, 30, 40, 50, 60], aaAd: [110, 115, 120, 125, 130], aaAppliesPassive: true },
    },
    // El daño (110-130 % AD) pasa a los AA durante el buff; las cargas y la duración van en mechanics.
    unset: ['damage', 'hasStacks', 'maxStacks', 'effectDuration'],
    why: 'el daño 110–130 % AD va en los AA del buff; cargas y duración en mechanics',
  },
  W: { mechanics: { appliesPassive: true } },
  E: { mechanics: { charges: { start: 2, max: 2, recharge: [45, 40, 35, 30, 25] } } },
};

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Ashe' });
  if (!doc?.abilities) throw new Error('Ashe no existe o no tiene habilidades');
  const $set: Record<string, unknown> = {};
  for (const [slot, change] of Object.entries(CHANGES) as [Slot, (typeof CHANGES)[Slot]][]) {
    const before = doc.abilities[slot];
    if (!before) throw new Error(`Ashe ${slot} no existe`);
    const next: ChampionAbility = { ...before, mechanics: { ...before.mechanics, ...change.mechanics } };
    for (const key of change.unset ?? []) delete next[key];
    const parsed = parseChampionAbilityPatch({ slot, ability: next }).ability;
    const removed = (change.unset ?? []).filter(key => before[key] !== undefined).map(key => `${key}=${JSON.stringify(before[key])}`);
    console.log(`${slot} «${before.name}»: mechanics → ${JSON.stringify(parsed.mechanics)}${removed.length ? ` · quita ${removed.join(', ')} (${change.why})` : ''}`);
    $set[`abilities.${slot}`] = parsed;
  }
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ashe-abilities`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { ...$set, updatedAt: new Date().toISOString() } });
  const after = await col.findOne({ _id: doc._id });
  for (const slot of Object.keys(CHANGES)) console.log(`después ${slot}: ${JSON.stringify(after?.abilities?.[slot])}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
