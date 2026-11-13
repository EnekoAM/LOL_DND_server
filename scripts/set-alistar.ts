/**
 * Alistar desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * Las curas % de vida máx. no se dividen entre 5. learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-alistar.ts --dry   |   npx tsx scripts/set-alistar.ts
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
    name: 'Triumphant Roar',
    description:
      'Al aturdir o desplazar a un campeón enemigo con sus habilidades: +1 acumulación de Triumphant Roar por campeón (máx. 7; no caducan en un combate típico, 99 t.; automático; no suma si el control falla, p. ej. escudo de hechizos o inmunidad). Al llegar a 7, consume todas y cura al portador un 5 % de su vida máx. y a los campeones aliados cercanos un 7 % de la suya (radio 5 casillas / 1000 u.; automático a todos los aliados del bando, filtrar a mano si alguno está fuera). Tras rugir, intervalo de 2 t. (3 s ÷ 2) en el que aún se pueden ganar acumulaciones; si llega a 7 durante el intervalo, ruge cuando acabe (a mano). También +1 si muere un súbdito o monstruo no épico cercano, +7 si muere un campeón o monstruo épico cercano (a mano). Al morir pierde todas las acumulaciones (a mano). Sin ratio de AP (cura % de vida máx., no plana ÷5).',
    learned: false,
    mechanics: {
      stacks: {
        turns: 99,
        max: 7,
        onAa: false,
        onChampionCc: true,
        perTarget: true,
        consumeAtMax: true,
        onMaxCooldown: 2,
        onMaxHeal: {
          selfRatios: [{ stat: 'hp', values: [5] }],
          allyRatios: [{ stat: 'hp', values: [7] }],
          alliesToo: true,
        },
      },
    },
  },
  Q: {
    name: 'Pulverize',
    description:
      'Golpea el suelo en disco (radio 2 casillas / 375 u.; 1,875 redondeado): daño mágico 70/75/80/85/90 % AP (80 % en rango 3, ±0,05; sin base plana 60–220; automático). Lanza al aire 1 t. (1 s ÷ 2, mín. 1; automático). En la wiki aturde y lanza al aire a la vez 1 s; el aturdimiento simultáneo, a mano si se quiere el segundo estado. Se puede cargar durante Headbutt (a mano).',
    learned: false,
    cost: '25/28/30/33/35',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.7, 0.75, 0.8, 0.85, 0.9], apSource: 'total' },
    effect: [{ name: 'Lanzado al aire', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Lanzado al aire',
    area: disk(2),
  },
  W: {
    name: 'Headbutt',
    description:
      'Embestida al objetivo (alcance 3 casillas / 650 u.; 3,25 redondeado; el desplazamiento a mano): si llega a 2 casillas / 400 u., daño mágico 90/95/100/105/110 % AP (100 % en rango 3, ±0,05; sin base plana 55–275; automático), aturdimiento 1 t. (0,75 s ÷ 2, mín. 1; automático) y empuje 4 casillas / 700 u. (3,5 redondeado; a mano; duración del empuje 1 t. / 0,5 s ÷ 2). El combo Headbutt + Pulverize reduce el empuje a 1 casilla / 200 u. (a mano). La inmunidad al desplazamiento no evita el aturdimiento (a mano).',
    learned: false,
    cost: '25/28/30/33/35',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.9, 0.95, 1, 1.05, 1.1], apSource: 'total' },
    effect: [{ name: 'Aturdimiento', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Aturdimiento',
  },
  E: {
    name: 'Trample',
    description:
      'Durante 3 t. (5 s ÷ 2) queda en estado Trample (no bloquea la habilidad; fantasmal a mano) y pisa en disco (radio 2 casillas / 350 u.): en este motor, un pulso al lanzarla con el daño total 60/65/70/75/80 % AP (70 % en rango 3, ±0,05; no se usa el 7 % por tic para no dejar ratios negativos; sin bases planas 8–20 por tic / 80–200 total; automático). Si el pulso daña al menos a un campeón, +1 acumulación (máx. 5, duran 3 t.; automático). Los tics siguientes (cada 0,5 s) a mano (también las acumulaciones de esos tics). Al llegar a 5, arma el siguiente AA a un campeón 3 t. (6 s ÷ 2): aturdimiento 1 t. (automático) y termina Trample (automático). El daño mágico extra del AA potenciado (20–275 según nivel) se omite por ser base plana (a mano).',
    learned: false,
    cost: '25/28/30/33/35',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.6, 0.65, 0.7, 0.75, 0.8], apSource: 'total' },
    area: disk(2),
    mechanics: {
      selfStatus: { name: 'Trample', turns: 3, blocksAbility: false },
      stacks: {
        turns: 3,
        max: 5,
        onAa: false,
        onAbilityHit: true,
        requiresDamage: true,
        perTarget: false,
        armArmedAaAtMax: true,
        armArmedAaTurns: 3,
      },
      armedAa: {
        type: 'magic',
        effectName: 'Aturdimiento',
        effectDuration: 1,
        effect: [{ name: 'Aturdimiento', duration: [1] }],
        endsSelfStatus: true,
      },
    },
  },
  R: {
    name: 'Unbreakable Will',
    description:
      'Al usarla, limpia los controles de masas del portador (automático si el estado tiene un nombre de CC conocido; el resto a mano) y gana Unbreakable Will 4 t. (7 s ÷ 2): reducción de daño 55/65/75 % (valores por rango, no es ratio AD/AP; automático). El daño verdadero no se reduce (a mano).',
    learned: false,
    cost: '50',
    resource: 'mana',
    mechanics: {
      cleanse: true,
      selfStatus: {
        name: 'Unbreakable Will',
        turns: 4,
        blocksAbility: false,
        damageReductionValues: [55, 65, 75],
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
  const doc = await col.findOne({ champion: 'Alistar' });
  if (!doc) throw new Error('Alistar no está en la base');

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-alistar`);
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
