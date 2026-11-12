/**
 * Jarvan IV (Eneko): la W es el escudo (Égida Dorada / Golden Aegis) y la E el estandarte (Estandarte Demaciano / Demacian Standard).
 * Lo suyo del estandarte (nombre, descripción, área) pasa de W a E; su coste 15 se queda en W (= 30 ÷ 2 de Golden Aegis) y su
 * coste 28 en E (= 55 ÷ 2). El desplazamiento que estaba en la E es el combo de la Q (Golpe del Dragón → estandarte): va a su texto.
 * Lo que falta, desde la wiki con las reglas de conversión (coste y segundos ÷ 2, cooldown = rango central, ratio ±0.05 por rango,
 * base plana fuera, 1 casilla = 200 u). Copia champions en backups/<fecha>-jarvan-w-e/ antes.
 *   npx tsx scripts/set-jarvan-w-e.ts --dry   |   npx tsx scripts/set-jarvan-w-e.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

/** Área alrededor del usuario de radio r casillas (como set-champion-abilities: tablero impar, sin la casilla del usuario). */
function selfArea(r: number) {
  const size = Math.min(21, Math.max(5, 2 * r + 3 | 1));
  const c = (size - 1) / 2;
  const tiles: [number, number][] = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if ((x !== c || y !== c) && Math.hypot(x - c, y - c) <= r + 0.4) tiles.push([x, y]);
  return { size, user: [c, c] as [number, number], target: null, tiles };
}

const COMBO = 'Si la lanza alcanza el Estandarte Demaciano, Jarvan IV se desplaza rapidamente hasta el, infligiendo daño fisico a los enemigos en su camino y levantandolos por los aires (1 t.): a mano.';

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Jarvan IV' });
  const ab = doc?.abilities;
  if (!doc || !ab?.Q || !ab.W || !ab.E) throw new Error('Jarvan IV Q/W/E no existe');
  const oldW = ab.W;
  const oldE = ab.E;

  const W: ChampionAbility = {
    name: 'Egida Dorada',
    description: 'Jarvan IV ralentiza a los enemigos cercanos y se protege con un escudo. Escudo = 70 % del AD bonus durante 2 t. (+1.3 % de su vida máxima por cada campeón enemigo alcanzado): a mano.',
    learned: oldW.learned,
    cost: oldW.cost,          // 15 (suyo) = 30 ÷ 2
    resource: oldW.resource,
    cooldown: 5,              // 9 s ÷ 2
    effect: [{ name: 'Ralentización', values: [0.15, 0.2, 0.25, 0.3, 0.35], duration: [1] }], // 2 s ÷ 2
    effectTarget: 'enemy',
    effectName: 'Ralentización',
    effectDuration: 1,
    area: selfArea(3),        // radio 600 u
  };
  const E: ChampionAbility = {
    name: oldW.name,          // Estandarte Demaciano (suyo)
    description: `${oldW.description ?? ''} Pasiva: +20/22.5/25/27.5/30 % de velocidad de ataque permanente: a mano. La bandera dura 4 t.; el aura de velocidad de ataque a los aliados cercanos: a mano.`.trim(),
    learned: oldE.learned,
    cost: oldE.cost,          // 28 (suyo) = 55 ÷ 2
    resource: oldE.resource,
    damage: { type: 'magic', ap: [0.7, 0.75, 0.8, 0.85, 0.9], apSource: 'total' }, // 80 % AP
    cooldown: 6,              // 11 s (rango central) ÷ 2
    mechanics: { buff: { turns: 4, attackSpeed: [20, 22.5, 25, 27.5, 30] } }, // aura de la bandera para Jarvan (8 s ÷ 2)
    ...(oldW.area ? { area: oldW.area } : {}), // su área (la dibujó para el estandarte)
  };
  const Q: ChampionAbility = { ...ab.Q, description: ab.Q.description?.includes('Estandarte') ? ab.Q.description : `${ab.Q.description ?? ''} ${COMBO}`.trim() };

  const set: Record<string, ChampionAbility> = {};
  for (const [slot, ability] of [['Q', Q], ['W', W], ['E', E]] as const) {
    const parsed = parseChampionAbilityPatch({ slot, ability }).ability;
    set[`abilities.${slot}`] = parsed;
    console.log(`${slot} antes:   ${JSON.stringify(ab[slot])}`);
    console.log(`${slot} después: ${JSON.stringify(parsed)}`);
  }
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-jarvan-w-e`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  await col.updateOne({ _id: doc._id }, { $set: { ...set, updatedAt: new Date().toISOString() } });
  const after = await col.findOne({ _id: doc._id });
  console.log(`después: ${JSON.stringify(after?.abilities)}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
