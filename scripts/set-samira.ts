/**
 * Samira desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango), sin base plana,
 * 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1), sin CD (bloqueo por efecto/buff activo).
 * P por tramos 1/6/11/16. Actualiza la config de Samira (learned false, stacks en P, R las exige,
 * robo de vida en Q/R, −30 % SPE automático). Copia champions en backups/<fecha>-samira/ antes.
 *   npx tsx scripts/set-samira.ts --dry   |   npx tsx scripts/set-samira.ts
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
    name: 'Daredevil Impulse',
    description:
      'Los AA y las habilidades que dañan a un campeón enemigo con un golpe distinto al anterior generan 1 de Estilo en esta pasiva (máx. 6, 3 t., se refresca; grados E–S). Cada carga da 2,75/3/3,25/3,5% de vel. movimiento según nivel (1/6/11/16), hasta 16,5/18/19,5/21% (a mano la vel. movimiento). Con 6 (S) se puede usar Inferno Trigger. A 1 casilla ataca con la espada (sin proyectil) y, junto con Blade Whirl, Wild Rush y el tajo/explosivos de Flair, inflige daño mágico bonus (~3,5/5,8/8,1/10,4% AD en esos tramos), hasta el doble según la vida faltante del objetivo (a mano). Contra un enemigo inmovilizado, el AA dispara 6 proyectiles (17% AD cada uno, con robo de vida; a mano); si está un poco fuera de rango, Samira da un dash hasta su alcance. Si el objetivo está lanzado, lo vuelve a lanzar (1 t.). Mismo objetivo: 5 t. de inmunidad.',
    learned: false,
    mechanics: { stacks: { turns: 3, max: 6, onAbilityHit: true } },
  },
  Q: {
    name: 'Flair',
    description:
      'Disparo en línea (5 casillas) al primer enemigo. Si hay un enemigo a 2 casillas o menos delante, en su lugar hace un tajo en cono (a mano el área). Si se lanza durante Wild Rush, deja explosivos en la estela que detonan al terminar el dash (a mano). Puede criticar y aplica robo de vida al 100% de eficacia (la wiki lo da al 100%; el omnivampirismo también cura). El disparo es un proyectil (se puede destruir; el tajo y los explosivos no).',
    learned: false,
    cost: '15',
    resource: 'mana',
    damage: { type: 'physical', ad: [1, 1.05, 1.1, 1.15, 1.2], adSource: 'total' },
    area: line(5),
    mechanics: { lifeSteal: { efficacy: 100 } },
  },
  W: {
    name: 'Blade Whirl',
    description:
      'Gira la espada 1 t. y destroza los proyectiles enemigos en el área (a mano). Dos tajos (el daño de la ficha es por tajo): el primero al instante y el segundo al acabar. Durante el giro no puede hacer AA ni lanzar Flair. Inferno Trigger corta el efecto (sin el segundo tajo).',
    learned: false,
    cost: '30',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.4, 0.45, 0.5, 0.55, 0.6], adSource: 'bonus' },
    area: disk(2),
    mechanics: { selfStatus: { name: 'Destroza proyectiles', turns: 1 } },
  },
  E: {
    name: 'Wild Rush',
    description:
      'Dash de 3 casillas hacia un enemigo o estructura (a mano el desplazamiento), daño mágico a quienes atraviesa. Gana velocidad de ataque 3 t. Un derribo en 2 t. tras dañar a un campeón reinicia Wild Rush (a mano; en este sistema la E está bloqueada mientras dura el bonus de vel. ataque). Se puede lanzar Flair e Inferno Trigger durante el dash.',
    learned: false,
    cost: '20',
    resource: 'mana',
    damage: { type: 'magic', ad: [0.1, 0.15, 0.2, 0.25, 0.3], adSource: 'bonus' },
    area: line(3),
    mechanics: { buff: { turns: 3, attackSpeed: [20, 25, 30, 35, 40] } },
  },
  R: {
    name: 'Inferno Trigger',
    description:
      'Requiere rango S (6 de Estilo de Daredevil Impulse; las gasta al lanzarla). Durante 1 t. dispara a los enemigos cercanos (hasta 10 disparos; el daño de la ficha es por disparo, puede criticar y aplica robo de vida al 100% de eficacia —la wiki lo da al 100%; el omnivampirismo también cura) y pierde 30% de vel. movimiento (automático). Hace falta un enemigo cercano para lanzarla. Durante el efecto no puede hacer AA ni lanzar Flair o Blade Whirl. El CC que interrumpe o el desarmado lo cancelan (a mano).',
    learned: false,
    resource: 'ninguno',
    damage: { type: 'physical', ad: [0.3, 0.4, 0.5], adSource: 'total' },
    area: disk(3),
    mechanics: {
      requireStacks: { from: 'Daredevil Impulse', count: 6 },
      lifeSteal: { efficacy: 100 },
      selfStatus: { name: 'Inferno Trigger (−30% vel. movimiento)', turns: 1, value: 30, stat: 'spe', pct: -30 },
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
    if (value === undefined) continue;
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
  const doc = await col.findOne({ champion: 'Samira' });
  if (!doc) throw new Error('Samira no está en la base');

  const next: Record<string, ChampionAbility> = { ...(doc.abilities ?? {}) };
  const changed: Record<string, ChampionAbility> = {};
  const lines: string[] = [];
  for (const slot of ['P', 'Q', 'W', 'E', 'R'] as const) {
    const wanted = ABILITIES[slot];
    const existing = (doc.abilities?.[slot] ?? {}) as Loose;
    // Actualización intencionada de Samira: se aplica la config nueva (learned, mecánicas, texto).
    const merged: Loose = { ...existing, ...wanted };
    if (wanted['mechanics'] && existing['mechanics'] && typeof existing['mechanics'] === 'object') {
      merged['mechanics'] = { ...(existing['mechanics'] as Loose), ...(wanted['mechanics'] as Loose) };
      // La R ya no posee el contador de Estilo (pasa a la P).
      if (slot === 'R') delete (merged['mechanics'] as Loose).stacks;
    }
    const parsed = parseChampionAbilityPatch({ slot, ability: merged as ChampionAbility }).ability;
    lines.push(`${slot} antes: ${JSON.stringify(existing)}`);
    lines.push(`${slot} → ${JSON.stringify(parsed)}`);
    next[slot] = parsed;
    changed[slot] = parsed;
  }

  console.log(lines.join('\n'));
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  if (!Object.keys(changed).length) { console.log('Nada que escribir'); process.exit(0); }

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-samira`);
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
