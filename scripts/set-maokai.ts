/**
 * Maokai desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango), sin base plana,
 * 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1), sin CD (bloqueo por efecto/buff activo).
 * P por tramos 1/6/11/16. learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-maokai.ts --dry   |   npx tsx scripts/set-maokai.ts
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
    name: 'Sap Magic',
    description:
      'El siguiente AA cura 4 / 6,6 / 9,2 / 11,8 % de la vida máx. (tramos 1/6/11/16; en la wiki 4–12,8 % lineal hasta el 18; automático, con poder de curación y escudos). CD 15 / 14 / 13 / 11 t. (30–20 s ÷ 2). Usar una habilidad quita 2 t. (4 s ÷ 2; automático). Si un Esqueje acierta a un campeón al detonar, otros 2 t. (automático; monstruo épico a mano). Si le pega una habilidad enemiga, 2 t. (botón «Le han lanzado una habilidad»; monstruo grande 1 t. a mano). No se dispara por encima del 95 % de vida máx. (automático). No se dispara contra estructuras ni si el AA falla por ceguera (a mano).',
    learned: false,
    mechanics: {
      empoweredAa: {
        healHpPct: [4, 6.6, 9.2, 11.8],
        hpSource: 'max',
        cooldown: [15, 14, 13, 11],
        byLevel: true,
        reduceOnAbility: 2,
        reduceOnStruck: 2,
        skipAboveHpPct: 95,
      },
    },
  },
  Q: {
    name: 'Bramble Smash',
    description:
      'Lanza una onda en línea (3 casillas / 600 u.): daño mágico 40/45/50/55/60 % AP (50 % en rango 3, ±0,05) + 2,5/3/3,5/4/4,5 % de la vida máx. del objetivo (sin base plana; automático). Ralentiza 99 % durante 1 t. (0,25 s ÷ 2, mín. 1; automático). A los enemigos cercanos (radio ~2 casillas / 325 u.) también los aturde 1 t. (0,5 s ÷ 2) y los empuja ~2 casillas (300 u.) (aturdimiento y empuje a mano). El daño plano extra a monstruos va a mano.',
    learned: false,
    cost: '20',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.4, 0.45, 0.5, 0.55, 0.6], apSource: 'total', hp: [0.025, 0.03, 0.035, 0.04, 0.045], hpSource: 'max' },
    effect: [{ name: 'Ralentización', values: [99], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: line(3),
  },
  W: {
    name: 'Twisted Advance',
    description:
      'Carga hacia un enemigo (alcance 3 casillas / 525 u.) y queda intocable durante la carga (a mano; no se pone estado de 1 t.). Al llegar: daño mágico 30/35/40/45/50 % AP (40 % en rango 3, ±0,05; sin base plana) y Enraizamiento 1 t. (1–1,4 s ÷ 2 → 1 en todos los rangos; automático). Si el objetivo se aleja demasiado o está intocable al llegar, no aplica (a mano).',
    learned: false,
    cost: '30',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.3, 0.35, 0.4, 0.45, 0.5], apSource: 'total' },
    effect: [{ name: 'Enraizamiento', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Enraizamiento',
  },
  E: {
    name: 'Sapling Toss',
    description:
      'Lanza un Esqueje al suelo (alcance 6 casillas / 1100 u.; 5,5 redondeado). Queda 15 t. (30 s ÷ 2) y se detona con el botón «Detonar» (perseguir 2 t. / 2,5 s ÷ 2 y el movimiento van a mano). Al detonar, explosión (radio ~1 casilla / 250 u.): daño mágico 15/20/25/30/35 % AP (25 % en rango 3, ±0,05) + 5 % de la vida bonus del portador (automático) y ralentiza 45 % durante 1 t. (2 s ÷ 2). Si se coloca en un matorral: dura 15 t. más 1,5 % de vida bonus, daño doble en 3 pulsos, ralentización extra y revelar 2 t. (3 s ÷ 2), todo a mano. Acertar a un campeón al detonar quita 2 t. al CD de Sap Magic (además de los 2 t. por lanzar E).',
    learned: false,
    cost: '30 / 33 / 35 / 38 / 40',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.15, 0.2, 0.25, 0.3, 0.35], apSource: 'total', hp: [0.05], hpSource: 'bonus', hpFrom: 'self' },
    effect: [{ name: 'Ralentización', values: [45], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: disk(1),
    mechanics: {
      trap: { turns: 15, name: 'Esqueje' },
      reduceEmpoweredAaOnHit: 2,
    },
  },
  R: {
    name: "Nature's Grasp",
    description:
      'Invoca un muro de zarzas en línea (alcance real 15 casillas / 3000 u.; el área del tablero pinta 10, límite 21×21). Daño mágico 75/85/95 % AP (wiki 75 % +0,1 por rango, sin base plana) y Enraizamiento 1–2 t. según la distancia recorrida (0,75–2,25 s ÷ 2; 1 t. automático, el segundo a mano si ha viajado lejos). Al acertar a un campeón, gana 40/50/60 % de SPE durante 1 t. (2 s ÷ 2; automático al usarla). El avance del muro y que cada zarza se detenga al chocar van a mano.',
    learned: false,
    cost: '50',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.75, 0.85, 0.95], apSource: 'total' },
    effect: [{ name: 'Enraizamiento', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Enraizamiento',
    area: line(10),
    mechanics: {
      selfStatus: { name: "Nature's Grasp", turns: 1, stat: 'spe', pctValues: [40, 50, 60] },
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
  const doc = await col.findOne({ champion: 'Maokai' });
  if (!doc) throw new Error('Maokai no está en la base');

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-maokai`);
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
