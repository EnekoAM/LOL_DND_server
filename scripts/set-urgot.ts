/**
 * Urgot desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango), sin base plana,
 * 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1), sin CD (bloqueo por efecto/buff activo).
 * P por tramos 1/6/11/16. learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-urgot.ts --dry   |   npx tsx scripts/set-urgot.ts
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
    name: 'Echoing Flames',
    description:
      'Seis patas-escopeta (60° cada una, círculo completo, radio 4 casillas). Cada una dispara una vez y entra en su propio CD (15/10/5/3 t. en los tramos 1/6/11/16; a nivel 18 en la wiki serían 2,5 s → 1 t.). El siguiente AA que acierte en el arco de una pata lista dispara un cono: 40/60/80/100% AD + 2/3,5/5/6% de la vida máx. del objetivo (físico, automático al AA si hay una pata lista; no aplica robo de vida, sí omnivampirismo). El cono y qué pata (orientación fija, no rota) van a mano. Tope contra monstruos a mano. Las patas no se disparan si el objetivo está muerto al impactar, si está ciego o si el AA lo bloquea un muro (a mano).',
    learned: false,
    damage: { type: 'physical', ad: [0.4, 0.6, 0.8, 1], adSource: 'total', hp: [0.02, 0.035, 0.05, 0.06], hpSource: 'max' },
    area: disk(4),
    mechanics: { sectorShots: { count: 6, cooldown: [15, 10, 5, 3], byLevel: true } },
  },
  Q: {
    name: 'Corrosive Charge',
    description:
      'Lanza un bidón al suelo (alcance 4 casillas). Tras un instante explota (radio 1 casilla): daño físico (70% AD total en rango 3, ±0,05, sin base plana) y ralentiza 45/50/55/60/65% durante 1 t. (1,25 s ÷ 2). Marca a los campeones alcanzados 3 t. para Purge (solo uno a la vez; a mano).',
    learned: false,
    cost: '35',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.6, 0.65, 0.7, 0.75, 0.8], adSource: 'total' },
    effect: [{ name: 'Ralentización', values: [45, 50, 55, 60, 65], duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Ralentización',
    area: disk(1),
  },
  W: {
    name: 'Purge',
    description:
      'Interruptor 2 t. (4 s ÷ 2); en rango 5 dura hasta desactivarlo (en la wiki es permanente al máximo). Coste 20/15/10/5/0. Mientras está activo: el número de ataques por turno pasa a 3 (automático; en la wiki es 3.0 de vel. de ataque fija). Dispara AA automáticos al enemigo más cercano (prioridad al marcado; a mano cada disparo, pulsa AA) al 17/22/27/32/37% AD (27% en rango 3, ±0,05; automático al AA), no pueden criticar (automático), aplican impacto al 50% y robo de vida (el 50% de impacto va a mano). Gana 40% de res. a ralentizaciones (automático) y pierde 125 de vel. movimiento (a mano; el equivalente en SPE no está claro). Fantasma contra súbditos, alcance ~2 casillas. En rangos 1–4, si no la desactivas, acaba sola a los 2 t. Otras habilidades (Q/E/R) cortan un instante el fuego (a mano).',
    learned: false,
    cost: '20 / 15 / 10 / 5 / 0',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.17, 0.22, 0.27, 0.32, 0.37], adSource: 'total' },
    area: disk(2),
    mechanics: {
      toggle: { turns: [2, 2, 2, 2, 0], fixedAttacks: 3 },
      buff: { turns: 2, aaAd: [17, 22, 27, 32, 37] },
      selfStatus: { name: 'Purge', turns: 2, stat: 'slowResistPct', amount: 40 },
      critNoDamage: true,
    },
  },
  E: {
    name: 'Disdain',
    description:
      'Se da un escudo 2 t. (4 s ÷ 2): 125/130/135/140/145% AD bonus + 8,5/11/13,5/16/18,5% vida bonus (135% y 13,5% en rango 3, ±0,05; automático). Luego carga 2 casillas (sin atravesar terreno): daño físico 90/95/100/105/110% AD bonus (100% en rango 3, ±0,05) y aturde 1 t. a quienes atraviesa, apartándolos. Al chocar con un campeón se detiene, lo aturde 1 t. (1,5 s ÷ 2) y lo lanza 1 casilla a su espalda (sin atravesar terreno; a mano el desplazamiento). Se puede lanzar Purge durante la carga (a mano).',
    learned: false,
    cost: '30 / 35 / 40 / 45 / 50',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.9, 0.95, 1, 1.05, 1.1], adSource: 'bonus' },
    effect: [{ name: 'Aturdimiento', duration: [1] }],
    effectTarget: 'enemy',
    effectDuration: 1,
    effectName: 'Aturdimiento',
    area: line(2),
    mechanics: {
      castPool: {
        kind: 'shield',
        turns: 2,
        ratios: [
          { stat: 'bonusAd', values: [125, 130, 135, 140, 145] },
          { stat: 'bonusHp', values: [8.5, 11, 13.5, 16, 18.5] },
        ],
      },
    },
  },
  R: {
    name: 'Fear Beyond Death',
    description:
      'Dispara un taladro en línea (alcance real 13 casillas / 2500 u.; el área del tablero pinta 10, límite 21×21). Al primer campeón: daño físico 50/60/70% AD bonus (wiki 50% y +0,1 por rango, sin base plana) y lastre 2 t. (4 s ÷ 2), revelado y ralentizado 0–75% según la vida que le falte (a mano la ralentización). Si está a ≤ 25% de vida máx. (o cae a ese umbral), Recast «Mercy» (1 vez, 2 t.): lo ejecuta (daño = lo que le queda, automático) y aplica Miedo 1 t. (75% de ralentización) a los cercanos que elijas (radio real 3 casillas). El canal de 1,5 s, el arrastre, la inmunidad a daño ajeno y que el recast no se interrumpa por CC van a mano. Si el taladro ya lo mataría, en la wiki se recastea solo (aquí: Recast cuando esté bajo el umbral).',
    learned: false,
    cost: '50',
    resource: 'mana',
    damage: { type: 'physical', ad: [0.5, 0.6, 0.7], adSource: 'bonus' },
    effect: [{ name: 'Lastre', duration: [2] }],
    effectTarget: 'enemy',
    effectDuration: 2,
    effectName: 'Lastre',
    area: line(10),
    mechanics: {
      recast: { times: 1, turns: 2 },
      execute: { hpPct: 25, fear: { name: 'Miedo', turns: 1, value: 75 } },
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
  const doc = await col.findOne({ champion: 'Urgot' });
  if (!doc) throw new Error('Urgot no está en la base');

  const changed: Record<string, ChampionAbility> = {};
  const lines: string[] = [];
  const rep: Report = { set: [], conflicts: [] };
  for (const slot of ['P', 'Q', 'W', 'E', 'R'] as const) {
    const wanted = ABILITIES[slot];
    const existing = { ...((doc.abilities?.[slot] ?? {}) as Loose) };
    const merged: Loose = { ...existing };
    fill(merged, wanted, `${slot}.`, rep);
    if (slot === 'W' && typeof merged.description === 'string' && merged.description.includes('~13 disparos a 3.0 de vel. de ataque') && typeof wanted.description === 'string') {
      merged.description = wanted.description;
      rep.set.push('W.description (actualizado: ataques fijos 3)');
      const index = rep.conflicts.findIndex(line => line.startsWith('W.description:'));
      if (index >= 0) rep.conflicts.splice(index, 1);
    }
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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-urgot`);
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
