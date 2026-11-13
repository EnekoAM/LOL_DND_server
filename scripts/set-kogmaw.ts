/**
 * Kog'Maw desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-kogmaw.ts --dry   |   npx tsx scripts/set-kogmaw.ts
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
    name: 'Icathian Surprise',
    description:
      'Al recibir daño letal (botón «Al morir»): entra en estado zombi 2 t. (4 s ÷ 2), impasable / inobjetivo / inmune a control y no puede atacar, lanzar habilidades ni usar objetos (a mano). Gana +50 % SPE mientras dura (en la wiki sube de 10 % a 50 %; aquí se aplica el máximo; automático). Al acabar (o con «Explotar»): explosión de daño verdadero en radio 2 casillas / 400 u. La base plana 140–650 según nivel se omite (regla de daño plano); el daño va a mano.',
    learned: false,
    area: disk(2),
    mechanics: {
      deathBurst: { turns: 2, name: 'Icathian Surprise', stat: 'spe', pct: 50 },
    },
  },
  Q: {
    name: 'Caustic Spittle',
    description:
      'Pasiva (si está aprendida): +5/10/15/20/25 % de velocidad de ataque (automático). Activa (alcance 6 casillas / 1200 u., primer enemigo): daño mágico 80/85/90/95/100 % AP (90 % en rango 3, ±0,05; sin base plana; automático) y reduce CA y RM 16/20/24/28/32 % 2 t. (4 s ÷ 2; automático, el % se calcula sobre la CA/RM del objetivo al aplicarlo).',
    learned: false,
    cost: '20',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.8, 0.85, 0.9, 0.95, 1], apSource: 'total' },
    effect: [{ name: 'Reducción de resistencias', values: [16, 20, 24, 28, 32], duration: [2] }],
    effectTarget: 'enemy',
    effectDuration: 2,
    effectName: 'Reducción de resistencias',
    mechanics: {
      learnedStats: [{ stat: 'atkSpePct', values: [5, 10, 15, 20, 25] }],
      resistShred: { pct: [16, 20, 24, 28, 32], turns: 2 },
    },
  },
  W: {
    name: 'Bio-Arcane Barrage',
    description:
      'Durante 4 t. (8 s ÷ 2): +1 casilla de alcance de ataque (130–210 u. ≈ 0,65–1,05; se aplica +1 en todos los rangos; automático) y los AA infligen daño mágico adicional 3/3,75/4,5/5,25/6 % de la vida máx. del objetivo + 1,5 % por cada 100 de AP (automático; no se aplica la regla ±0,05 a estos % de vida). Tope 100 contra súbditos y monstruos, y no afecta a estructuras (a mano).',
    learned: false,
    cost: '20',
    resource: 'mana',
    mechanics: {
      selfStatus: { name: 'Bio-Arcane Barrage', turns: 4, stat: 'range', amount: 1 },
      aaOnHit: { hp: [3, 3.75, 4.5, 5.25, 6], hpSource: 'max', apPer100: 1.5, type: 'magic' },
    },
  },
  E: {
    name: 'Void Ooze',
    description:
      'Lanza un moco en línea (alcance 7 casillas / 1360 u.; 6,8 redondeado; ancho ~1 casilla / 240 u.): daño mágico 55/60/65/70/75 % AP (65 % en rango 3, ±0,05; sin base plana; automático) y Ralentización 40/45/50/55/60 % 2 t. (3 s ÷ 2; automático a quienes alcance el proyectil). El rastro de moco dura 2 t. y ralentiza a quienes entren después (a mano).',
    learned: false,
    cost: '20 / 28 / 35 / 43 / 50',
    resource: 'mana',
    damage: { type: 'magic', ap: [0.55, 0.6, 0.65, 0.7, 0.75], apSource: 'total' },
    effect: [{ name: 'Ralentización', values: [40, 45, 50, 55, 60], duration: [2] }],
    effectTarget: 'enemy',
    effectDuration: 2,
    effectName: 'Ralentización',
  },
  R: {
    name: 'Living Artillery',
    description:
      'Artillería (alcance 7/8/9 casillas / 1300/1550/1800 u.; 6,5/7,75/9 redondeado; radio ~1 casilla / 240 u.): daño mágico 75/85/95 % AD bonus (75 % en la wiki en todos los rangos, +0,1/rango) + 35/45/55 % AP (35 % en rango 1, +0,1/rango; en la wiki es 35/40/45 %; sin base plana; automático). Si el objetivo está por debajo del 40 % de vida máx., el daño ×2 (automático si se conoce la vida; si no, a mano). Por encima de ese umbral, el daño escala hasta +50 % según la vida faltante (automático si se conoce la vida). Revelación 1 t. (2 s ÷ 2; a mano; no revela en sigilo). Cada uso en 4 t. (8 s ÷ 2) suma 20 de coste de maná (40 LoL ÷ 2), hasta 9 acumulaciones (máx. 200; automático). El coste base es 20.',
    learned: false,
    cost: '20',
    resource: 'mana',
    damage: { type: 'magic', ad: [0.75, 0.85, 0.95], adSource: 'bonus', ap: [0.35, 0.45, 0.55], apSource: 'total' },
    area: disk(1),
    mechanics: {
      costStacks: { amount: 20, turns: 4, max: 9 },
      damageLowHp: { belowHpPct: 40, multiplier: 2, missingMaxBonusPct: 50 },
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
  const doc = await col.findOne({ champion: "Kog'Maw" });
  if (!doc) throw new Error("Kog'Maw no está en la base");

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-kogmaw`);
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
