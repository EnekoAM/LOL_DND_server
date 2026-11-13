/**
 * Bel'Veth desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-belveth.ts --dry   |   npx tsx scripts/set-belveth.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';
import type { AreaPattern } from '../src/areaPattern';

type Loose = Record<string, unknown>;

const odd = (n: number) => Math.min(21, Math.max(5, n % 2 ? n : n + 1));

const line = (len: number): AreaPattern => {
  const size = odd(2 * len + 1);
  const c = (size - 1) / 2;
  const tiles: [number, number][] = [];
  for (let y = c - len; y < c; y++) tiles.push([c, y]);
  return { size, user: [c, c], target: null, tiles };
};

const disk = (r: number): AreaPattern => {
  const size = odd(2 * r + 3);
  const c = (size - 1) / 2;
  const tiles: [number, number][] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if ((x !== c || y !== c) && Math.hypot(x - c, y - c) <= r + 0.4) tiles.push([x, y]);
    }
  }
  return { size, user: [c, c], target: null, tiles };
};

const ABILITIES: Record<string, Loose> = {
  P: {
    name: 'Death in Lavender',
    description:
      'Sin tope de velocidad de ataque y no gana vel. ataque por nivel (a mano / en la ficha). Tras lanzar una habilidad: +20 % vel. ataque 2 t. (3 s ÷ 2; automático, se refresca; el ghosting a mano). Al derribar a un campeón o jugador: +2 acumulaciones permanentes de Lavanda; monstruo grande o súbdito grande: +1 (automático en derribo; los súbditos pequeños no deberían contar, a mano). Cada acumulación: +0,1 / 0,66 / 1,22 / 1,78 % vel. ataque (tramos 1/6/11/16; en la wiki 0,1–2 % lineal hasta el 18; automático).',
    learned: false,
    mechanics: {
      permanentStacks: {
        onAbilityChampionHit: false,
        onTakedown: true,
        takedownChampion: 2,
        takedownOther: 1,
        stat: 'atkSpePct',
        perStack: [0.1, 0.66, 1.22, 1.78],
        byLevel: true,
      },
      onAbilityUse: { turns: 2, attackSpeed: [20] },
    },
  },
  Q: {
    name: 'Void Surge',
    description:
      'Cuatro dashes cardinales independientes (alcance 2 casillas / 400 u.). Cada dirección tiene su propio CD 8/8/7/7/6 t. (16/15/14/13/12 s ÷ 2) y hay 2/2/2/1/1 t. entre dashes (4/3,25/2,5/1,75/1 s ÷ 2; automático). Daño físico 95/100/105/110/115 % AD (105 % en rango 3, ±0,05; sin base plana 12–20; automático). El primer objetivo aplica efectos de impacto y robo de vida (automático; el crítico a mano). Los objetivos secundarios del dash son de área y no aplican impacto (a mano). +70 a monstruos (plano, omitido). La forma verdadera permite atravesar terreno y suma alcance (a mano). El CD de las direcciones se reduce con vel. ataque bonus (a mano). W al acertar un campeón reinicia 1 dirección (automático).',
    learned: false,
    damage: { type: 'physical', ad: [0.95, 1, 1.05, 1.1, 1.15], adSource: 'total' },
    appliesOnHit: true,
    mechanics: {
      sectorShots: {
        count: 4,
        cooldown: [8, 8, 7, 7, 6],
        trigger: 'cast',
        gap: [2, 2, 2, 1, 1],
        labels: ['N', 'S', 'E', 'O'],
      },
      lifeSteal: { efficacy: 100 },
    },
  },
  W: {
    name: 'Above and Below',
    description:
      'Golpe en línea (alcance 3 casillas / 660 u. ≈ 3,3; ancho 1 casilla / 200 u.): daño mágico 140/145/150/155/160 % AP (150 % en rango 3, ±0,05; sin base plana; automático), Lanzado al aire 1 t. (0,6–1,0 s ÷ 2, mín. 1; automático) y Ralentización 30 % 1 t. (2 s ÷ 2; segundo efecto, a mano si el motor solo aplica el primero). Si acierta a un campeón, reinicia una dirección de Void Surge (automático).',
    learned: false,
    damage: { type: 'magic', ap: [1.4, 1.45, 1.5, 1.55, 1.6], apSource: 'total' },
    effect: [
      { name: 'Lanzado al aire', duration: [1] },
      { name: 'Ralentización', values: [30], duration: [1] },
    ],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Lanzado al aire',
    area: line(3),
    mechanics: {
      resetSectorShots: { from: 'Void Surge', count: 1, requiresChampionHit: true },
    },
  },
  E: {
    name: 'Royal Maelstrom',
    description:
      'Canaliza 1 t. (1,5 s ÷ 2; no puede moverse, a mano). Gana reducción de daño 20/30/40/50/60 % y robo de vida 20/25/30/35/40 % mientras dura (automático). Corta al enemigo más herido en radio 3 casillas / 500 u. (2,5 redondeado) hasta 6 veces + 1 por cada 40 % de vel. ataque bonus (automático el número si se conoce la vel. ataque). Cada corte: daño físico 2/7/12/17/22 % AD (12 % en rango 3, ±0,05; sin base plana 10–18) aumentado 0–100 % según la vida faltante del objetivo (hasta ×2; automático si se conoce la vida). Aplica robo de vida (automático). Los efectos de impacto/ataque se aplican al 12–24 % según vida faltante (a mano). 200 % a monstruos (a mano). Se puede terminar antes (botón «Terminar»; automático). Se acaba si lanza otra habilidad (a mano). Puede criticar (a mano).',
    learned: false,
    damage: { type: 'physical', ad: [0.02, 0.07, 0.12, 0.17, 0.22], adSource: 'total' },
    area: disk(3),
    mechanics: {
      selfStatus: {
        name: 'Royal Maelstrom',
        turns: 1,
        cancelable: true,
        damageReductionValues: [20, 30, 40, 50, 60],
        stats: [{ stat: 'lifeStealPct', amountValues: [20, 25, 30, 35, 40] }],
      },
      lifeSteal: { efficacy: 100 },
      strikes: { count: [6, 6, 6, 6, 6], perBonusAtkSpe: 40 },
      damageLowHp: { belowHpPct: 1, multiplier: 2, missingMaxBonusPct: 100 },
    },
  },
  R: {
    name: 'Endless Banquet',
    description:
      'Pasiva: cada AA inflige daño verdadero adicional 3 % AD bonus (sin base plana 2/4/6; el 3 % se mantiene en todos los rangos, sin +0,1/rango por ser un ratio muy pequeño) y genera una marca 3 t. (5 s ÷ 2) en ese objetivo que aumenta el mismo valor por golpe (automático, sin tope; tope 8 contra monstruos épicos a mano). Los derribos de campeón dejan un Coral del Vacío 8 t. (15 s ÷ 2; automático al derribar campeón/jugador; monstruos épicos a mano si no cuentan como campeón). Activa (requiere un coral): consume todos los corales, concede 1 Lavanda por coral (automático), Ralentización 25 % 1 t. (el ramp 25–96 % en 1 s ÷ 2 queda a mano) y explosión de daño verdadero en radio 3 casillas / 500 u. (2,5 redondeado): 150/160/170 % AP (150 % en rango 1, +0,1/rango) + 20 % de la vida faltante (sin base plana 150/200/250; automático). Luego Forma verdadera 23 t. (45 s ÷ 2) / 45 t. (90 s ÷ 2) / hasta la muerte con 0 / 40 / 80 acumulaciones de Lavanda (automático): +20/50/80 PV (100/250/400 ÷ 5, sin redondear) + 150/160/170 % AD bonus y AP, y +6/13/20 % vel. ataque total (automático). El bonus de alcance 25/75/125 u. (0,13/0,38/0,63 casillas) y el tamaño (a mano). Q puede atravesar terreno (a mano). Si ya está en forma, refresca la duración y cura 20/50/80 PV + 150/160/170 % AD bonus y AP (automático). Coral mejorado y Rémoras del Vacío (a mano). Se pierde al morir (a mano).',
    learned: false,
    damage: { type: 'true', ap: [1.5, 1.6, 1.7], apSource: 'total', hp: [0.2, 0.2, 0.2], hpSource: 'missing' },
    effect: [{ name: 'Ralentización', values: [25], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: disk(3),
    mechanics: {
      aaOnHit: { ad: [0.03, 0.03, 0.03], adSource: 'bonus', type: 'true', always: true, perTargetStacks: { turns: 3 } },
      stacks: { turns: 8, max: 10, onAa: false, onChampionTakedown: true },
      requireStacks: { from: 'Endless Banquet', count: 1 },
      grantPermanent: { from: 'Death in Lavender', perConsumedStack: true },
      selfStatus: {
        name: 'True Form',
        turns: 23,
        blocksAbility: false,
        durationByStacks: { from: 'Death in Lavender', thresholds: [{ stacks: 40, turns: 45 }, { stacks: 80, turns: 0 }] },
        stats: [
          {
            stat: 'hp',
            amountValues: [20, 50, 80],
            ratios: [
              { stat: 'bonusAd', values: [150, 160, 170] },
              { stat: 'ap', values: [150, 160, 170] },
            ],
          },
          { stat: 'atkSpePct', amountValues: [6, 13, 20] },
        ],
      },
      castPool: {
        kind: 'heal',
        flat: [20, 50, 80],
        ratios: [
          { stat: 'bonusAd', values: [150, 160, 170] },
          { stat: 'ap', values: [150, 160, 170] },
        ],
        requiresSelfStatus: true,
      },
    },
  },
};

const TYPE_ALIAS: Record<string, string> = { fisico: 'physical', físico: 'physical', magico: 'magic', mágico: 'magic' };
const norm = (v: unknown) => JSON.stringify(v, (_k, x) => {
  if (typeof x === 'string') return TYPE_ALIAS[x.toLowerCase()] ?? x;
  if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)));
  return x;
});
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const brief = (v: unknown) => { const s = JSON.stringify(v); return s.length > 90 ? `${s.slice(0, 87)}…` : s; };

type Report = { set: string[]; conflicts: string[] };

function fill(target: Loose, wanted: Loose, label: string, rep: Report) {
  for (const [key, value] of Object.entries(wanted)) {
    if (value === undefined || key === 'learned') continue;
    const have = target[key];
    if (empty(have)) { target[key] = value; rep.set.push(`${label}${key}`); continue; }
    if (typeof have === 'object' && have && !Array.isArray(have) && typeof value === 'object' && value && !Array.isArray(value)) {
      fill(have as Loose, value as Loose, `${label}${key}.`, rep);
      continue;
    }
    if (norm(have) !== norm(value)) rep.conflicts.push(`${label}${key}: suyo ${brief(have)} · wiki ${brief(value)}`);
  }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: "Bel'Veth" });
  if (!doc) throw new Error("Bel'Veth no está en la base");

  const changed: Record<string, ChampionAbility> = {};
  const lines: string[] = [];
  const rep: Report = { set: [], conflicts: [] };
  for (const slot of ['P', 'Q', 'W', 'E', 'R'] as const) {
    const wanted = ABILITIES[slot];
    const existing = { ...((doc.abilities?.[slot] ?? {}) as Loose) };
    const merged: Loose = { ...existing };
    fill(merged, wanted, `${slot}.`, rep);
    merged.learned = false;
    if (existing.learned !== false && existing.learned !== undefined) rep.set.push(`${slot}.learned (forzado a false)`);
    else if (empty(existing.learned)) rep.set.push(`${slot}.learned`);
    const parsed = parseChampionAbilityPatch({ slot, ability: merged as ChampionAbility }).ability;
    lines.push(`${slot} antes: ${JSON.stringify(existing)}`);
    lines.push(`${slot} → ${JSON.stringify(parsed)}`);
    changed[slot] = parsed;
  }

  console.log(lines.join('\n'));
  console.log(`SET ${rep.set.length}: ${rep.set.join(', ') || '—'}`);
  console.log(`CONFLICTS ${rep.conflicts.length}: ${rep.conflicts.join(' | ') || '—'}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  if (!Object.keys(changed).length) { console.log('Nada que escribir'); process.exit(0); }

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-belveth`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);

  const $set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const [slot, ability] of Object.entries(changed)) $set[`abilities.${slot}`] = ability;
  await col.updateOne({ _id: doc._id }, { $set });
  const after = (await col.findOne({ _id: doc._id }))?.abilities ?? {};
  console.log(`después: ${Object.keys(after).join(', ')}`);
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
