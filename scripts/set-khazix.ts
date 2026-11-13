/**
 * Kha'Zix desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear (10 de cura LoL = 2 D&D); los ratios de AP siguen la regla habitual.
 * learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-khazix.ts --dry   |   npx tsx scripts/set-khazix.ts
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
    name: 'Unseen Threat',
    description:
      'El siguiente ataque básico contra un campeón tras estar sin visión o al usar Void Assault inflige daño mágico extra 50 % AD bonus (sin base plana; automático si está armado) y Ralentización 25 % 1 t. (2 s ÷ 2; automático). Se arma a mano con «Armar» (ha perdido la visión / está invisible) o automáticamente al usar la R.',
    learned: false,
    mechanics: {
      armedAa: {
        type: 'magic',
        ad: [0.5],
        adSource: 'bonus',
        effectName: 'Ralentización',
        effectDuration: 1,
        effect: [{ name: 'Ralentización', values: [25], duration: [1] }],
      },
    },
  },
  Q: {
    name: 'Taste Their Fear',
    description:
      'Habilidad de unidad (alcance ~2 casillas / 325 u.): daño físico 95/100/105/110/115 % AD bonus (105 % en rango 3, ±0,05; sin base plana; automático). Si el objetivo está aislado (sin aliados a ~2 casillas / 375 u.; a juicio de mesa), el daño es ×2,1 (automático con «Objetivo aislado»). Evolución Reaper Claws: +0,25 casillas de alcance en AA y Q (50 u.; a mano; se puede contar como 1 casilla) y, en LoL, −45 % CD si está aislado (aquí no hay CD de habilidades; no se convierte).',
    learned: false,
    cost: '10',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.95, 1, 1.05, 1.1, 1.15], adSource: 'bonus' },
    mechanics: {
      isolated: { multiplier: 2.1 },
      evolve: { name: 'Reaper Claws' },
    },
  },
  W: {
    name: 'Void Spike',
    description:
      'Lanza una púa (alcance 5 casillas / 1025 u.) que explota (radio ~1 casilla / 275 u.): daño físico 90/95/100/105/110 % AD bonus (100 % en rango 3, ±0,05; sin base plana; automático). Si está en la explosión, se cura 11/15/19/23/27 (55–135 LoL ÷ 5, sin redondear) + 40/45/50/55/60 % AP (50 % en rango 3, ±0,05; automático con «Estoy en el área»). Evolución Spike Racks: tres púas en cono (a mano; no hay daño/cura extra por varias explosiones), Ralentización 40 % 2 t. (2,25 s ÷ 2; 60 % si el objetivo está aislado, automático con «Objetivo aislado») y Revelación 2 t. (a mano).',
    learned: false,
    cost: '28 / 30 / 33 / 35 / 38',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.9, 0.95, 1, 1.05, 1.1], adSource: 'bonus' },
    area: disk(1),
    mechanics: {
      castPool: {
        kind: 'heal',
        flat: [11, 15, 19, 23, 27],
        ratios: [{ stat: 'ap', values: [40, 45, 50, 55, 60] }],
        requiresSelfInArea: true,
      },
      evolve: {
        name: 'Spike Racks',
        effect: [{ name: 'Ralentización', values: [40], duration: [2] }],
        effectName: 'Ralentización',
        effectDuration: 2,
        effectTarget: 'enemy',
        isolated: { slowPct: 60 },
      },
    },
  },
  E: {
    name: 'Leap',
    description:
      'Salta al punto elegido (alcance 4 casillas / 700 u.; 3,5 redondeado; zona de aterrizaje ~1,5 casillas / 300 u.): daño físico 30/35/40/45/50 % AD bonus (40 % en rango 3, ±0,05; sin base plana; automático). Se puede usar Taste Their Fear durante el salto (a mano). Evolución Wings: alcance 5 casillas / 1000 u. (a mano) y, al conseguir una eliminación o asistencia, un Leap extra gratis (recast hasta usarlo; automático).',
    learned: false,
    cost: '25',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.3, 0.35, 0.4, 0.45, 0.5], adSource: 'bonus' },
    area: disk(1),
    mechanics: {
      evolve: {
        name: 'Evolved Wings',
        recastOnTakedown: { times: 1, turns: 0 },
      },
    },
  },
  R: {
    name: 'Void Assault',
    description:
      'Se vuelve Invisible 1 t. (1,25 s ÷ 2) y gana +40 % SPE mientras dura (automático). Arma Unseen Threat (automático). Tras acabar la invisibilidad, se puede relanzar 1 vez gratis durante 6 t. (ventana 12 s ÷ 2; el retraso de 2 s de la wiki no se modela; automático; no se puede recastear mientras está Invisible). Cada rango de la R da 1 hueco de evolución permanente (1/2/3; automático; la 4.ª por la caza de Rengar va a mano). Evolución Adaptive Cloaking: 2 recasts (3 usos en total); la duración evolucionada (2 s) también queda en 1 t. con la regla de tiempos.',
    learned: false,
    cost: '50',
    resource: 'mana',
    mechanics: {
      selfStatus: { name: 'Invisible', turns: 1, stat: 'spe', pct: 40, blocksRecast: true },
      recast: { times: 1, turns: 6 },
      armArmedAa: true,
      evolutions: { slots: [1, 2, 3] },
      evolve: { name: 'Adaptive Cloaking', recast: { times: 2, turns: 6 } },
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
  const doc = await col.findOne({ champion: "Kha'zix" });
  if (!doc) throw new Error("Kha'zix no está en la base");

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-khazix`);
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
