/**
 * Ida y vuelta del editor (abilityToDraft -> draftToAbility) sobre todas las
 * habilidades de la base. No escribe nada.
 *   npx tsx scripts/test-mechanics-roundtrip.ts
 */
import { getDb } from '../src/db';
import { abilityToDraft, draftToAbility, draftToMechanics, mechanicsToDraft } from '../../web/src/features/habilidades/abilityDraft';

type Loose = Record<string, unknown>;

const DEFAULT_TRUE = new Set([
  'onAa',
  'requiresDamage',
  'consume',
  'damageOnDetonate',
  'onAbilityChampionHit',
  'armor',
  'mr',
]);

const DEFAULT_TOTAL = new Set(['adSource', 'apSource']);

function dropDefault(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (DEFAULT_TRUE.has(key) && value === true) return true;
  if (DEFAULT_TOTAL.has(key) && value === 'total') return true;
  if (key === 'learned' && value === false) return true;
  return false;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(canonicalize).filter(item => item !== undefined);
    return items;
  }
  if (typeof value === 'object') {
    const obj = value as Loose;
    const out: Loose = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === 'sourceMechanics') continue;
      const raw = obj[key];
      if (dropDefault(key, raw)) continue;
      const next = canonicalize(raw);
      if (next === undefined) continue;
      if (typeof next === 'object' && next && !Array.isArray(next) && !Object.keys(next as Loose).length) continue;
      out[key] = next;
    }
    return out;
  }
  return value;
}

function norm(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null);
}

type Diff = { path: string; before: unknown; after: unknown };

function diffs(before: unknown, after: unknown, path: string, acc: Diff[]): void {
  if (norm(before) === norm(after)) return;
  const bObj = before && typeof before === 'object' && !Array.isArray(before);
  const aObj = after && typeof after === 'object' && !Array.isArray(after);
  if (bObj || aObj) {
    const keys = new Set([...Object.keys((before as Loose) ?? {}), ...Object.keys((after as Loose) ?? {})]);
    for (const key of [...keys].sort()) {
      if (key === 'sourceMechanics') continue;
      diffs((before as Loose)?.[key], (after as Loose)?.[key], path ? `${path}.${key}` : key, acc);
    }
    return;
  }
  acc.push({ path: path || '(root)', before, after });
}

function brief(value: unknown): string {
  const text = JSON.stringify(value);
  if (text == null) return 'undefined';
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

async function main() {
  const db = await getDb();
  const col = db.collection<{ champion: string; abilities?: Record<string, Loose> }>('champions');
  const docs = await col.find({}).project({ champion: 1, abilities: 1 }).toArray();

  let abilities = 0;
  let withMechanics = 0;
  let ok = 0;
  const failures: string[] = [];
  const throws: string[] = [];
  const today = new Set(['Samira', 'Smolder', 'Urgot', 'Maokai', 'Soraka', "Kha'Zix", "Kog'Maw", "Bel'Veth", 'Ezreal', 'Alistar', 'Ahri', 'Kayle']);
  const todayFail: string[] = [];

  for (const doc of docs) {
    const champ = doc.champion;
    const slots = doc.abilities ?? {};
    for (const [slot, ability] of Object.entries(slots)) {
      if (!ability || typeof ability !== 'object') continue;
      abilities += 1;
      if (ability.mechanics && typeof ability.mechanics === 'object') withMechanics += 1;
      const label = `${champ} ${slot}`;
      try {
        const draft = abilityToDraft(ability as never);
        const mechanicsOut = draftToMechanics(draft.mechanics);
        const found: Diff[] = [];
        diffs(ability.mechanics, mechanicsOut, 'mechanics', found);
        if (!found.length) {
          ok += 1;
          continue;
        }
        const lines = found.map(item => `  ${item.path}: ${brief(item.before)} \u2192 ${brief(item.after)}`);
        const msg = `${label}: ${found.length} diff(s)\n${lines.join('\n')}`;
        failures.push(msg);
        if (today.has(champ)) todayFail.push(msg);
      } catch (error) {
        const msg = `${label}: EXCEPCI\u00d3N ${error instanceof Error ? error.message : String(error)}`;
        throws.push(msg);
        if (today.has(champ)) todayFail.push(msg);
      }
    }
  }

  console.log(`Campeones: ${docs.length}`);
  console.log(`Habilidades: ${abilities} (con mec\u00e1nicas: ${withMechanics})`);
  console.log(`Ida y vuelta OK (mec\u00e1nicas): ${ok}`);
  console.log(`Fallos: ${failures.length}`);
  console.log(`Excepciones: ${throws.length}`);
  if (todayFail.length) {
    console.log('--- Fallos de campeones de hoy ---');
    console.log(todayFail.join('\n'));
  } else {
    console.log('Campeones de hoy: ida y vuelta OK');
  }
  if (failures.length) {
    console.log('--- Todos los fallos (mec\u00e1nicas) ---');
    console.log(failures.join('\n'));
  }
  if (throws.length) {
    console.log('--- Excepciones ---');
    console.log(throws.join('\n'));
  }
  console.log('[dry] nada escrito');
  if (failures.length || throws.length) process.exit(1);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
