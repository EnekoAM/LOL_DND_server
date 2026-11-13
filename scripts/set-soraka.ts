/**
 * Soraka desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear (10 de cura LoL = 2 D&D); los ratios de AP siguen la regla habitual.
 * El % de vida máx. del coste de la W no se divide (ya es relativo a la vida convertida).
 * learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-soraka.ts --dry   |   npx tsx scripts/set-soraka.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';
import type { AreaPattern } from '../src/areaPattern';

type Loose = Record<string, unknown>;

const odd = (n: number) => Math.min(21, Math.max(5, n % 2 ? n : n + 1));

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
    name: 'Salvation',
    description:
      'Gana 90 % de velocidad de movimiento extra mientras se dirige hacia aliados cercanos que estén por debajo del 40 % de su vida máx. (radio 13 casillas / 2500 u.; 12,5 redondeado). Automático no: hay que aplicarlo a mano (dirección y «hacia» un aliado).',
    learned: false,
  },
  Q: {
    name: 'Starcall',
    description:
      'Llama una estrella al punto elegido (alcance 4 casillas / 800 u., radio ~1 casilla / 265 u.): daño mágico 25/30/35/40/45 % AP (35 % en rango 3, ±0,05; sin base plana; automático) y Ralentización 30 % 1 t. (1,5 s ÷ 2; automático). Si acierta a al menos un campeón, Rejuvenation 2 t. (2,5 s ÷ 2): cura inmediata 12/15/18/21/24 (60–120 LoL ÷ 5, sin redondear) + 20/25/30/35/40 % AP (30 % en rango 3, ±0,05; automático; en la wiki es cura a lo largo de 2,5 s, aquí se aplica el total de una vez) y +20/22,5/25/27,5/30 % SPE (automático). Mientras tenga Rejuvenation, Astral Infusion también se la da al aliado (a mano).',
    learned: false,
    cost: '23 / 25 / 28 / 30 / 33',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.25, 0.3, 0.35, 0.4, 0.45], apSource: 'total' },
    effect: [{ name: 'Ralentización', values: [30], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: disk(1),
    mechanics: {
      castPool: {
        kind: 'heal',
        flat: [12, 15, 18, 21, 24],
        ratios: [{ stat: 'ap', values: [20, 25, 30, 35, 40] }],
        requiresHit: true,
        requiresChampionHit: true,
      },
      selfStatus: {
        name: 'Rejuvenation',
        turns: 2,
        stat: 'spe',
        pctValues: [20, 22.5, 25, 27.5, 30],
        requiresChampionHit: true,
      },
    },
  },
  W: {
    name: 'Astral Infusion',
    description:
      'Cura a un aliado (alcance 3 casillas / 550 u.; 2,75 redondeado): 18/22/26/30/34 (90–170 LoL ÷ 5, sin redondear) + 40/45/50/55/60 % AP (50 % en rango 3, ±0,05; automático). Cuesta 20/23/25/28/30 maná (40–60 ÷ 2) y 10 % de la vida máx. propia (el % no se divide; automático; no baja de 1 PV). No se puede usar por debajo del 5 % de vida máx. (automático). No se lanza a sí misma (a mano). Si tiene Rejuvenation, el coste de vida se reduce 80/85/90/95/100 % (queda 2/1,5/1/0,5/0 %; a mano) y el aliado también gana Rejuvenation 2 t. (a mano).',
    learned: false,
    cost: '20 / 23 / 25 / 28 / 30',
    resource: 'mana',
    mechanics: {
      costHpMaxPct: 10,
      costHpMinCurrentPct: 5,
      castPool: {
        kind: 'heal',
        target: 'ally',
        flat: [18, 22, 26, 30, 34],
        ratios: [{ stat: 'ap', values: [40, 45, 50, 55, 60] }],
      },
    },
  },
  E: {
    name: 'Equinox',
    description:
      'Crea una zona (alcance 5 casillas / 925 u., radio ~1 casilla / 260 u.): al colocar, daño mágico 30/35/40/45/50 % AP (40 % en rango 3, ±0,05; sin base plana) y Silencio 1 t. (1,5 s ÷ 2; automático). La zona dura 1 t.; «Detonar» (quienes sigan dentro, a mano) aplica el mismo daño otra vez y Enraizamiento 1 t. (1–2 s ÷ 2 → 1 en todos los rangos; automático).',
    learned: false,
    cost: '35 / 38 / 40 / 43 / 45',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.3, 0.35, 0.4, 0.45, 0.5], apSource: 'total' },
    effect: [{ name: 'Silencio', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Silencio',
    area: disk(1),
    mechanics: {
      trap: {
        turns: 1,
        name: 'Equinoccio',
        applyOnPlace: true,
        eruptEffect: [{ name: 'Enraizamiento', duration: [1] }],
        eruptEffectName: 'Enraizamiento',
        eruptEffectDuration: 1,
      },
    },
  },
  R: {
    name: 'Wish',
    description:
      'Cura global a sí misma y a todos los aliados (automático): 30/50/70 (150/250/350 LoL ÷ 5, sin redondear) + 50/60/70 % AP (50 % en rango 1, +0,1/rango). Si el objetivo está por debajo del 40 % de su vida máx., la cura es ×1,5 (45/75/105 + 75/85/95 % AP; automático, con poder de curación y escudos).',
    learned: false,
    cost: '50',
    resource: 'mana',
    mechanics: {
      castPool: {
        kind: 'heal',
        flat: [30, 50, 70],
        ratios: [{ stat: 'ap', values: [50, 60, 70] }],
        alliesToo: true,
        allAllies: true,
        lowHpBonus: { belowHpPct: 40, multiplier: 1.5 },
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
  const doc = await col.findOne({ champion: 'Soraka' });
  if (!doc) throw new Error('Soraka no está en la base');

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-soraka`);
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
