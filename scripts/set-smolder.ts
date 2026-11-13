/**
 * Smolder desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango), sin base plana,
 * 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1), sin CD (bloqueo por efecto/buff activo).
 * P por tramos 1/6/11/16. learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-smolder.ts --dry   |   npx tsx scripts/set-smolder.ts
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
    name: 'Dragon Practice',
    description:
      'Cargas permanentes (se guardan en la ficha del jugador, como las de ítems; en un campeón o NPC solo duran ese combate; sin tope práctico, máx. 999). +1 por cada campeón enemigo único alcanzado con una habilidad que dañe. Super Scorcher Breath también suma +1 por cada súbdito o monstruo que derribe (no por matar al campeón, que ya suma al acertar). Flap, Flap, Flap solo da 1 por lanzamiento, aunque alcance a varios. Achooo! solo da 1 por campeón (el primer golpe). Las básicas hacen daño mágico extra según esas cargas (automático; no aplica el robo de vida de la Q, sí el omnivampirismo): Q 25/37/48/60% de las cargas en los tramos 1/6/11/16; explosiones de W 55%; cada bolt de E 8/10/12/14%. El extra por prob. de crítico (Q +0–10,5%, E +0–1,8%) va a mano. Si el objetivo de la Q muere en vuelo o por la quemadura, puede haber stacks extra (a mano).',
    learned: false,
    hasStacks: true,
    mechanics: { permanentStacks: { onAbilityChampionHit: true } },
  },
  Q: {
    name: 'Super Scorcher Breath',
    description:
      'Escupe una bola de fuego al objetivo (alcance 3 casillas). Daño físico (sin base plana; 130% AD bonus en rango 3, ±0,05). Aplica efectos de impacto y robo de vida al 50% de eficacia (el omnivampirismo también cura). El daño mágico extra de Dragon Practice no recibe ese robo de vida. Si mata al menos a un objetivo, recupera 8 de maná (a mano). El daño aumenta con la prob. de crítico (a mano). Elige la fase según las cargas permanentes de Dragon Practice (no las gasta): Explosión (25), Descargas (125) o Quemadura (225). En el LoL las mejoras se acumulan (225 incluye explosión, descargas y quemadura); aquí cada fase se lanza por separado (a mano lo que falte).',
    learned: false,
    cost: '13',
    resource: 'mana',
    damage: { type: 'physical', ad: [1.2, 1.25, 1.3, 1.35, 1.4], adSource: 'bonus' },
    appliesOnHit: true,
    area: line(3),
    phaseMode: 'choose',
    mechanics: {
      lifeSteal: { efficacy: 50 },
      grantPermanent: { from: 'Dragon Practice', onKill: true },
      stackDamage: { from: 'Dragon Practice', pct: [25, 37, 48, 60], type: 'magic', byLevel: true },
    },
    variants: [
      {
        name: 'Explosión (25)',
        description:
          'Con 25 cargas permanentes de Dragon Practice, la bola explota al impactar y hace el mismo daño físico (y el extra mágico de la P) a los enemigos cercanos (radio 1 casilla). También aplica impacto y robo de vida al 50%. No gasta las cargas.',
        area: disk(1),
        requiresStacks: { from: 'Dragon Practice', count: 25 },
      },
      {
        name: 'Descargas (125)',
        description:
          'Con 125 cargas, salen 2 (+0,8 por cada 100 cargas, redondeo hacia arriba) descargas en arco que hacen el 50% del daño de la bola (el de la ficha es por descarga: 65% AD bonus en rango 3, ±0,05). Aplican impacto y robo de vida al 50%, más el extra mágico de la P. El número de descargas va a mano. En el LoL esto se suma a la explosión (a mano o usa también la fase Explosión). No gasta las cargas.',
        damage: { type: 'physical', ad: [0.55, 0.6, 0.65, 0.7, 0.75], adSource: 'bonus' },
        area: disk(1),
        requiresStacks: { from: 'Dragon Practice', count: 125 },
      },
      {
        name: 'Quemadura (225)',
        description:
          'Con 225 cargas, los enemigos alcanzados arden 2 t. (3 s ÷ 2). El daño verdadero es % de vida máx. (2,5% por cada 100 AD bonus + 0,5% por cada 100 cargas, a lo largo de la duración) y hay execute al 6,5% de vida máx. del campeón (solo el daño de Smolder; a mano). Las quemaduras posteriores se acumulan sin refrescar la anterior (a mano). En el LoL se suma a explosión y descargas (a mano). No gasta las cargas.',
        effect: [{ name: 'Quemadura', duration: [2] }],
        effectTarget: 'enemy',
        effectDuration: 2,
        effectName: 'Quemadura',
        requiresStacks: { from: 'Dragon Practice', count: 225 },
      },
    ],
  },
  W: {
    name: 'Achooo!',
    description:
      'Estornuda un glóbulo en línea (8 casillas, ancho 1). Daño físico del glóbulo (60% AD bonus en rango 3, ±0,05) y ralentiza 35% durante 1 t. Al acertar a un campeón, usa la fase Explosión. Solo el primer golpe a cada campeón da 1 carga permanente de Dragon Practice (automático si eliges bien los objetivos).',
    learned: false,
    cost: '25 / 28 / 30 / 33 / 35',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.5, 0.55, 0.6, 0.65, 0.7], adSource: 'bonus' },
    effect: [{ name: 'Ralentización', values: [35], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: line(8),
    phaseMode: 'choose',
    variants: [
      {
        name: 'Explosión',
        description:
          'Al acertar a un campeón con el glóbulo, explosiona (radio 2 casillas). Daño físico 50% AD bonus y 80% AP en rango 3 (±0,05) más 55% de las cargas permanentes de Dragon Practice como daño mágico (automático; sin robo de vida). Las explosiones siguientes contra el mismo objetivo hacen el 75% de la anterior (a mano). El escudo de hechizos puede bloquear el glóbulo o la explosión, no ambos (a mano).',
        damage: { type: 'physical', ad: [0.4, 0.45, 0.5, 0.55, 0.6], ap: [0.7, 0.75, 0.8, 0.85, 0.9], adSource: 'bonus', apSource: 'total' },
        area: disk(2),
        stackDamage: { from: 'Dragon Practice', pct: [55], type: 'magic' },
      },
    ],
  },
  E: {
    name: 'Flap, Flap, Flap',
    description:
      'Vuela 1 t. (1,25 s ÷ 2): atraviesa terreno (fantasma) y gana 75% de vel. movimiento (automático). Mientras vuela, dispara hasta 5 (+1 por cada 100 cargas de Dragon Practice, hacia abajo) bolts al enemigo visible más cercano y más herido (prioridad campeones). El daño de la ficha es por bolt (30% AD total en rango 3, ±0,05) más el extra mágico de la P (8/10/12/14% de las cargas en tramos 1/6/11/16, automático; el extra por crítico va a mano). El número de bolts va a mano. Solo concede 1 carga permanente por lanzamiento. Se corta si lanza otra habilidad o recibe CC / autoinmovilización (a mano).',
    learned: false,
    cost: '33',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.2, 0.25, 0.3, 0.35, 0.4], adSource: 'total' },
    area: line(4),
    mechanics: {
      selfStatus: { name: 'Flap, Flap, Flap', turns: 1, stat: 'spe', pct: 75 },
      grantPermanent: { from: 'Dragon Practice', maxPerCast: 1 },
      stackDamage: { from: 'Dragon Practice', pct: [8, 10, 12, 14], type: 'magic', byLevel: true },
    },
  },
  R: {
    name: 'MMOOOMMMM!',
    description:
      'Llama a su madre: una ola de fuego en línea. Alcance real 21 casillas (4250 u); el área del tablero solo pinta las 10 primeras (límite 21×21 del editor). Se cura al lanzarla (75% AD bonus + 75% AP, automático; sin base plana). Daño físico 100% AD bonus y 100% AP en rango 1 (+0,1 por rango). Usa la fase Centro si el objetivo está en el centro de la ola. Hace el 50% a súbditos y monstruos (a mano).',
    learned: false,
    cost: '50',
    resource: 'mana',
    damage: { type: 'physical', ad: [1, 1.1, 1.2], ap: [1, 1.1, 1.2], adSource: 'bonus', apSource: 'total' },
    area: line(10),
    phaseMode: 'choose',
    mechanics: {
      castPool: {
        kind: 'heal',
        ratios: [
          { stat: 'bonusAd', values: [75, 75, 75] },
          { stat: 'ap', values: [75, 75, 75] },
        ],
      },
    },
    variants: [
      {
        name: 'Centro',
        description:
          'Los enemigos en el centro de la ola reciben un 50% más de daño (150/160/170% AD bonus y AP) y quedan ralentizados un 40% durante 1 t. (2 s ÷ 2). La cura es la misma que en la ola.',
        damage: { type: 'physical', ad: [1.5, 1.6, 1.7], ap: [1.5, 1.6, 1.7], adSource: 'bonus', apSource: 'total' },
        effect: [{ name: 'Ralentización', values: [40], duration: [1] }],
        effectTarget: 'enemy',
        effectDuration: 1,
        effectName: 'Ralentización',
      },
    ],
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
    if ((key === 'damage' || key === 'mechanics') && typeof have === 'object' && have && !Array.isArray(have) && typeof value === 'object' && value && !Array.isArray(value)) {
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
  const doc = await col.findOne({ champion: 'Smolder' });
  if (!doc) throw new Error('Smolder no está en la base');

  const next: Record<string, ChampionAbility> = { ...(doc.abilities ?? {}) };
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
    next[slot] = parsed;
    changed[slot] = parsed;
  }

  console.log(lines.join('\n'));
  console.log(`SET ${rep.set.length}: ${rep.set.join(', ') || '—'}`);
  console.log(`CONFLICTS ${rep.conflicts.length}: ${rep.conflicts.join(' | ') || '—'}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  if (!Object.keys(changed).length) { console.log('Nada que escribir'); process.exit(0); }

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-smolder`);
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
