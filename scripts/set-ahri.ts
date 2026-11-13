/**
 * Ahri desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * Nombres oficiales es-ES (Data Dragon). learned false.
 * Si el nombre o la descripción no coinciden con el kit / la conversión, se sustituyen (aprobado).
 *   npx tsx scripts/set-ahri.ts --dry   |   npx tsx scripts/set-ahri.ts
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
    name: 'Robo de esencias',
    description:
      'Al matar un súbdito o monstruo: +1 fragmento de esencia (máx. 9; 99 t.; automático). Al llegar a 9, consume todas y cura 7 / 10,5294117647 / 14,0588235294 / 17,5882352941 + 20 % AP (bases planas 35–95 según nivel ÷5, sin redondear; tramos 1/6/11/16; automático). Al derribar a un campeón o jugador: cura 15 / 20,2941176471 / 25,5882352941 / 30,8823529412 + 30 % AP (bases 75–165 ÷5, sin redondear; tramos 1/6/11/16; automático). En la wiki la cura de campeón exige haberle dañado en los 3 s previos (2 t.); si no hubo daño reciente, a mano. Las asistencias, a mano si el derribo no se registra como eliminación.',
    learned: false,
    mechanics: {
      stacks: {
        turns: 99,
        max: 9,
        onAa: false,
        onNonChampionKill: true,
        consumeAtMax: true,
        onMaxHeal: {
          flat: [7, 10.5294117647, 14.0588235294, 17.5882352941],
          flatByLevel: true,
          selfRatios: [{ stat: 'ap', values: [20] }],
        },
      },
      takedownHeal: {
        flat: [15, 20.2941176471, 25.5882352941, 30.8823529412],
        flatByLevel: true,
        ratios: [{ stat: 'ap', values: [30] }],
        champion: true,
      },
    },
  },
  Q: {
    name: 'Orbe del engaño',
    description:
      'Orbe en línea (alcance 5 casillas / 900 u.; 4,5 redondeado; ancho 1 casilla / 200 u.): al ir, daño mágico 40/45/50/55/60 % AP (50 % en rango 3, ±0,05; sin base plana 35–135; automático). Al volver, el mismo daño como verdadero a los mismos objetivos (automático; a mano si la trayectoria de regreso alcanza a otros). Cada enemigo solo cuenta una vez por pasada. El radio al girar (~0,5 casillas / 100 u.), a mano.',
    learned: false,
    cost: '28/33/38/43/48',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.4, 0.45, 0.5, 0.55, 0.6], apSource: 'total' },
    area: line(5),
    mechanics: { returnStrike: { type: 'true' } },
  },
  W: {
    name: 'Fuego zorruno',
    description:
      'Gana +40 % de velocidad (SPE) 1 t. (2 s ÷ 2; automático; en la wiki decae durante 2 s). Conjura tres fuegos zorrunos hasta 2 t. (2,5 s ÷ 2; el rastreo y el alcance ~3–4 casillas / 550–725 u. a mano). En este motor, un pulso al lanzarla: daño mágico 30/35/40/45/50 % AP (40 % en rango 3, ±0,05; sin base plana 40–120; automático; el primer fuego). Los dos siguientes al mismo objetivo hacen el 40 % de ese daño (16 % AP) (a mano). Prioridad: hechizados, luego campeones (a mano). Contra súbditos por debajo del 20 % de vida máx. el daño se duplica (a mano).',
    learned: false,
    cost: '15',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.3, 0.35, 0.4, 0.45, 0.5], apSource: 'total' },
    mechanics: {
      selfStatus: { name: 'Fuego zorruno', turns: 1, blocksAbility: false, stat: 'spe', pct: 40 },
    },
  },
  E: {
    name: 'Hechizar',
    description:
      'Beso en línea (alcance 5 casillas / 1000 u.; ancho ~1 casilla / 120 u.) al primer enemigo: daño mágico 75/80/85/90/95 % AP (85 % en rango 3, ±0,05; sin base plana 80–240; automático). Encantado 1 t. (1,2–1,8 s ÷ 2, mín. 1; en todos los rangos queda 1 t.; automático). En la wiki también derriba y ralentiza un 65 %; derribo y ralentización explícita, a mano si se quieren además del hechizo.',
    learned: false,
    cost: '30',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.75, 0.8, 0.85, 0.9, 0.95], apSource: 'total' },
    effect: [{ name: 'Encantado', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Encantado',
    area: line(5),
  },
  R: {
    name: 'Impulso espiritual',
    description:
      'Embestida hasta 3 casillas / 500 u. (2,5 redondeado; el desplazamiento a mano) y dispara rayos a hasta 3 enemigos visibles en 3 casillas / 600 u.: daño mágico 35/45/55 % AP (35 % en la wiki en rango 1, +0,1/rango; sin base plana 75/125/175; automático). Se puede relanzar 2 veces más gratis durante 8 t. (15 s ÷ 2; automático). Al derribar a un campeón o jugador, +1 recast (máx. 3 almacenados) y se refresca la ventana (automático; en la wiki hace falta haber consumido su esencia / haberle dañado en 3 s, y la extensión tiene tope de 10 s / 5 t.: a mano si se quiere limitar). El intervalo de 1 s entre lanzamientos no se convierte (sin CD). Fuego zorruno se puede lanzar durante la embestida (a mano).',
    learned: false,
    cost: '50',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.35, 0.45, 0.55], apSource: 'total' },
    area: disk(3),
    mechanics: {
      recast: { times: 2, turns: 8 },
      recastOnTakedown: { times: 1, turns: 8, max: 3, champion: true },
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
  const doc = await col.findOne({ champion: 'Ahri' });
  if (!doc) throw new Error('Ahri no está en la base');

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ahri`);
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
