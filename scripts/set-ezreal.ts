/**
 * Ezreal desde la wiki (reglas de Eneko): ratio rango 3 = wiki ±0,05/rango (R: wiki +0,1/rango),
 * sin base plana de daño, 200 u/casilla, coste y segundos ÷2 (mitades hacia arriba, duraciones mín. 1),
 * sin CD (bloqueo por efecto/buff activo). P por tramos 1/6/11/16.
 * Curas y escudos planos de LoL ÷5, sin redondear; los ratios de AP siguen la regla habitual.
 * learned false. No pisa valores ya puestos a mano (salvo learned).
 *   npx tsx scripts/set-ezreal.ts --dry   |   npx tsx scripts/set-ezreal.ts
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

const ABILITIES: Record<string, Loose> = {
  P: {
    name: 'Rising Spell Force',
    description:
      'Al acertar a un enemigo con una habilidad: +1 acumulación de Rising Spell Force por enemigo alcanzado (máx. 5; 3 t., 6 s ÷ 2; se refresca; automático, también si el escudo de hechizos bloquea el daño o la habilidad no inflige daño). Cada acumulación: +10 % vel. ataque (hasta +50 %; automático). No escala por nivel (no usa tramos 1/6/11/16).',
    learned: false,
    mechanics: {
      stacks: {
        turns: 3,
        max: 5,
        onAa: false,
        onAbilityHit: true,
        requiresDamage: false,
        perTarget: true,
        stat: 'atkSpePct',
        perStack: [10],
      },
    },
  },
  Q: {
    name: 'Mystic Shot',
    description:
      'Disparo en línea (alcance 6 casillas / 1200 u.; ancho ~1 casilla / 120 u.) al primer enemigo: daño físico 120/125/130/135/140 % AD (130 % en rango 3, ±0,05) + 30/35/40/45/50 % AP (40 % en rango 3, ±0,05; sin base plana 20–120; automático). Aplica efectos de impacto y robo de vida (automático; on-attack a mano). Si acierta, en LoL reduce 1,5 s el CD de todas sus habilidades (incluida esta); aquí no hay CD de habilidades, a mano.',
    learned: false,
    cost: '14/16/17/19/20',
    resource: 'mana',
    damage: { type: 'physical', ad: [1.2, 1.25, 1.3, 1.35, 1.4], adSource: 'total', ap: [0.3, 0.35, 0.4, 0.45, 0.5], apSource: 'total' },
    appliesOnHit: true,
    area: line(6),
    mechanics: {
      lifeSteal: { efficacy: 100 },
    },
  },
  W: {
    name: 'Essence Flux',
    description:
      'Orbe en línea (alcance 6 casillas / 1200 u.; ancho ~1 casilla / 160 u.) que marca al primer campeón, monstruo épico o estructura 2 t. (4 s ÷ 2; automático). El siguiente AA o habilidad contra el marcado detona la marca: daño mágico 90/95/100/105/110 % AD bonus (100 % en rango 3, ±0,05) + 80/85/90/95/100 % AP (90 % en rango 3, ±0,05; sin base plana 80–300; automático). Si la detona una habilidad, restaura 30 de maná (60 ÷ 2) más el coste de esa habilidad (automático). El orbe en sí no hace daño. Esta habilidad no detona su propia marca.',
    learned: false,
    cost: '25',
    resource: 'mana',
    damage: { type: 'magic', ad: [0.9, 0.95, 1, 1.05, 1.1], adSource: 'bonus', ap: [0.8, 0.85, 0.9, 0.95, 1], apSource: 'total' },
    effect: [{ name: 'Essence Flux', duration: [2] }],
    effectTarget: 'enemy',
    effectDuration: 2,
    effectName: 'Essence Flux',
    area: line(6),
    mechanics: {
      mark: {
        turns: 2,
        detonateOn: 'both',
        damageOnDetonate: true,
        refundMana: { flat: [30], refundCost: true },
      },
    },
  },
  E: {
    name: 'Arcane Shift',
    description:
      'Parpadeo hasta 2 casillas / 475 u. (2,375 redondeado; el desplazamiento a mano) y dispara un proyectil al enemigo más cercano en 4 casillas / 750 u. (3,75 redondeado): daño mágico 50/55/60/65/70 % AD bonus (60 % en rango 3, ±0,05) + 65/70/75/80/85 % AP (75 % en rango 3, ±0,05; sin base plana 80–280; automático). Prioriza al marcado por Essence Flux y lo revela 1 t. (1 s ÷ 2, mín. 1; a mano la revelación y la prioridad si hay varios).',
    learned: false,
    cost: '35',
    resource: 'mana',
    damage: { type: 'magic', ad: [0.5, 0.55, 0.6, 0.65, 0.7], adSource: 'bonus', ap: [0.65, 0.7, 0.75, 0.8, 0.85], apSource: 'total' },
  },
  R: {
    name: 'Trueshot Barrage',
    description:
      'Línea global (ancho 2 casillas / 320 u.; la trayectoria a mano): daño mágico 100/110/120 % AD bonus (100 % en la wiki en todos los rangos, +0,1/rango) + 110/120/130 % AP (110 % en rango 1, +0,1/rango; sin base plana 350–750; automático). En la wiki los súbditos y monstruos no épicos tienen menos daño de base (150–300) con los mismos ratios; al omitir bases el recorte no queda en el motor (a mano si se quiere aplicar). Otorga visión breve a su paso (a mano).',
    learned: false,
    cost: '50',
    resource: 'mana',
    damage: { type: 'magic', ad: [1, 1.1, 1.2], adSource: 'bonus', ap: [1.1, 1.2, 1.3], apSource: 'total' },
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
  const doc = await col.findOne({ champion: 'Ezreal' });
  if (!doc) throw new Error('Ezreal no está en la base');

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

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ezreal`);
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
