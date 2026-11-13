/**
 * Kayle desde la wiki V26.22 (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * Nombres oficiales es-ES (Data Dragon). learned false.
 * Si el nombre o la descripción no coinciden con el kit / la conversión, se sustituyen (aprobado).
 *   npx tsx scripts/set-kayle.ts --dry   |   npx tsx scripts/set-kayle.ts
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
    name: 'Ascenso divino',
    description:
      'Cuatro formas según el nivel del campeón (tramos 1/6/11/16; automático). Celo: cada AA da 1 carga (máx. 5; 3 t. / 5 s ÷ 2, se refresca; automático) y +6 % de velocidad de ataque por carga (atkSpePct; automático). Al llegar a 5, queda Exaltada: +10 % de SPE mientras mantenga el máximo (automático). Nv. 6 Alzada: +2 casillas de alcance de ataque (525 u. / 2,625 → 3 total si la base es 1; automática) y pasa a ser a distancia (el cambio cuerpo a cuerpo / a distancia de ítems y runas, a mano). Nv. 11 En llamas: estando Exaltada, el AA lanza una oleada (línea ~4 casillas / 755–850 u.; ancho 1 / 200 u.): daño mágico 10 % AD bonus + 25 % AP (sin base plana 20–41; la P innata no usa ±0,05; automático al objetivo del AA; el resto de la línea, a mano). Críticos de la oleada, a mano. Nv. 16 Trascendente: +1 casilla más de alcance (625 u. / 3,125 → 4 total, para que el tramo se note) y las 5 cargas / Exaltada son permanentes (automático). En la wiki V26.22 las oleadas siguen siendo mágicas en el 16 (no pasan a verdadero).',
    learned: false,
    mechanics: {
      stacks: {
        turns: 3,
        max: 5,
        onAa: true,
        stat: 'atkSpePct',
        perStack: [6],
        onMaxStatus: { name: 'Exaltada', stat: 'spe', pct: 10 },
      },
      levelThresholds: [
        { level: 6, name: 'Alzada', rangeBonus: 2 },
        {
          level: 11,
          name: 'En llamas',
          aaWave: { type: 'magic', ad: [0.1], adSource: 'bonus', ap: [0.25], apSource: 'total', requiresMaxStacks: true },
        },
        { level: 16, name: 'Trascendente', rangeBonus: 1, permanentMaxStacks: true },
      ],
    },
  },
  Q: {
    name: 'Ráfaga radiante',
    description:
      'Espada en línea (alcance 5 casillas / 900 u.; 4,5 redondeado; ancho ~1 casilla / 150 u.): daño mágico 50/55/60/65/70 % AD bonus (60 % en rango 3, ±0,05) y 40/45/50/55/60 % AP (50 % en rango 3, ±0,05; sin base plana 60–180; automático). Ralentización 25/30/35/40/45 % 1 t. (2 s ÷ 2; automático). −15 % CA y RM 2 t. (4 s ÷ 2; automático). Al impactar, la espada se ensancha en cruz (a mano: el área extra de la explosión).',
    learned: false,
    cost: '30/35/40/45/50',
    resource: 'mana',
    damage: { type: 'magic', ad: [0.5, 0.55, 0.6, 0.65, 0.7], adSource: 'bonus', ap: [0.4, 0.45, 0.5, 0.55, 0.6], apSource: 'total' },
    effect: [{ name: 'Ralentización', values: [25, 30, 35, 40, 45], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: line(5),
    mechanics: { resistShred: { pct: [15], turns: 2 } },
  },
  W: {
    name: 'Gracia celestial',
    description:
      'Cura a Kayle y a un aliado elegido (alcance 5 casillas / 900 u.; 4,5 redondeado; si se lanza sin objetivo válido prioriza al aliado más cercano con menos vida, a mano): 11 / 16 / 21 / 26 / 31 + 15/20/25/30/35 % AP (base 55–155 ÷5, sin redondear; 25 % AP en rango 3, ±0,05; automático). Ambas ganan +24/28/32/36/40 % de SPE 1 t. (2 s ÷ 2; automático en el portador; la misma velocidad en el aliado, a mano). El +8 % de SPE por cada 100 de AP, a mano.',
    learned: false,
    cost: '35/38/40/43/45',
    resource: 'mana',
    mechanics: {
      castPool: {
        kind: 'heal',
        flat: [11, 16, 21, 26, 31],
        ratios: [{ stat: 'ap', values: [15, 20, 25, 30, 35] }],
        alliesToo: true,
      },
      selfStatus: { name: 'Gracia celestial', turns: 1, blocksAbility: false, stat: 'spe', pctValues: [24, 28, 32, 36, 40] },
    },
  },
  E: {
    name: 'Filo purificador',
    description:
      'Pasiva (rango ≥ 1): los AA infligen daño mágico extra 0/5/10/15/20 % AD bonus (10 % en rango 3, ±0,05) y 10/15/20/25/30 % AP (20 % en rango 3, ±0,05; sin base plana 15–35; automático). Activa: arma el siguiente AA 3 t. (6 s ÷ 2; automático): daño mágico adicional 8/8,5/9/9,5/10 % de la vida faltante del objetivo + 1,5 % por cada 100 de AP (estos % de vida no usan ±0,05; automático; tope 400 contra monstruos, a mano). Nv. 11: ese AA explota en radio 2 casillas / 350 u. (1,75 redondeado) y aplica los impactos a los cercanos (el daño al principal es automático; explosión y on-hits a otros, a mano). Antes del nv. 6 el AA armado gana alcance 3 casillas / 525 u. (a mano). Reinicia el temporizador de ataque (a mano). No aplica el bonus a estructuras (a mano).',
    learned: false,
    mechanics: {
      aaOnHit: {
        always: true,
        type: 'magic',
        ad: [0, 0.05, 0.1, 0.15, 0.2],
        adSource: 'bonus',
        ap: [0.1, 0.15, 0.2, 0.25, 0.3],
        apSource: 'total',
      },
      armArmedAa: true,
      armedAa: {
        type: 'magic',
        turns: 3,
        hp: [8, 8.5, 9, 9.5, 10],
        hpSource: 'missing',
        apPer100: 1.5,
        explodeFromLevel: 11,
      },
    },
  },
  R: {
    name: 'Veredicto divino',
    description:
      'Elige a un aliado o a ti: invulnerabilidad (reducción de daño 100 %) 2 t. (2,5 s ÷ 2, techo 2; automático en el portador si no hay aliado elegido; en un aliado, a mano si no se designó objetivo). Tras esos 2 t., las espadas caen alrededor del objetivo (radio 3 casillas / 675 u.; en rango 3, 775 u. / 3,875 → 4, a mano): daño mágico 100/110/120 % AD bonus (100 % en la wiki en rango 1, +0,1/rango) y 70/80/90 % AP (70 % +0,1/rango; sin base plana 200/300/400; automático al detonar, eligiendo enemigos en el área). El área sigue al objetivo (a mano). Coste 50/25/0 maná.',
    learned: false,
    cost: '50/25/0',
    resource: 'mana',
    damage: { type: 'magic', ad: [1, 1.1, 1.2], adSource: 'bonus', ap: [0.7, 0.8, 0.9], apSource: 'total' },
    area: disk(3),
    mechanics: {
      protect: { name: 'Intervención', turns: 2, damageReductionPct: [100], target: 'allyOrSelf' },
      trap: { turns: 2, name: 'Veredicto divino' },
    },
  },
};

const TYPE_ALIAS: Record<string, string> = { fisico: 'physical', físico: 'physical', magico: 'magic', mágico: 'magic' };
const norm = (v: unknown) => JSON.stringify(v, (_k, x) => {
  if (typeof x === 'string') return TYPE_ALIAS[x.toLowerCase()] ?? x;
  if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.entries(x as Loose).sort(([a], [b]) => a.localeCompare(b)));
  return x;
});
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const brief = (v: unknown) => { const s = JSON.stringify(v); return s.length > 90 ? `${s.slice(0, 87)}…` : s; };

type Report = { set: string[]; conflicts: string[]; replaced: string[] };

function fill(target: Loose, wanted: Loose, label: string, rep: Report, overwriteKeys: Set<string>) {
  for (const [key, value] of Object.entries(wanted)) {
    if (value === undefined || key === 'learned') continue;
    const have = target[key];
    if (overwriteKeys.has(key) && !empty(have) && norm(have) !== norm(value)) {
      target[key] = value;
      rep.replaced.push(`${label}${key}: ${brief(have)} → ${brief(value)}`);
      continue;
    }
    if (empty(have)) { target[key] = value; rep.set.push(`${label}${key}`); continue; }
    if (typeof have === 'object' && have && !Array.isArray(have) && typeof value === 'object' && value && !Array.isArray(value)) {
      fill(have as Loose, value as Loose, `${label}${key}.`, rep, overwriteKeys);
      continue;
    }
    if (norm(have) !== norm(value)) rep.conflicts.push(`${label}${key}: suyo ${brief(have)} · wiki ${brief(value)}`);
  }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const doc = await col.findOne({ champion: 'Kayle' });
  if (!doc) throw new Error('Kayle no está en la base');

  const changed: Record<string, ChampionAbility> = {};
  const lines: string[] = [];
  const rep: Report = { set: [], conflicts: [], replaced: [] };
  const overwriteKeys = new Set(['name', 'description']);
  for (const slot of ['P', 'Q', 'W', 'E', 'R'] as const) {
    const wanted = ABILITIES[slot];
    const existing = { ...((doc.abilities?.[slot] ?? {}) as Loose) };
    const merged: Loose = { ...existing };
    fill(merged, wanted, `${slot}.`, rep, overwriteKeys);
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
  console.log(`REPLACED ${rep.replaced.length}: ${rep.replaced.join(' | ') || '—'}`);
  console.log(`CONFLICTS ${rep.conflicts.length}: ${rep.conflicts.join(' | ') || '—'}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  if (!Object.keys(changed).length) { console.log('Nada que escribir'); process.exit(0); }

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-kayle`);
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
