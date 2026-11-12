/**
 * Pedido de Eneko (12-11-2026):
 *  1. Gloria en dos variantes (glory:dark-seal / glory:mejai) con la regla actual de glory copiada tal cual; cada ítem a la suya.
 *  2. Samael: stacks viejos por ítem → cargas permanentes (effect:manaflow = Lágrima, effect:timeless = Vara de las edades);
 *     quita la clave duplicada «item:Lagrima de la diosa» después de copiar.
 *  3. Flechas de los Yun Tal: texto 0.16 → 0.2 por carga.
 * Copia namedEffectDescriptions, items y players en backups/<fecha>-glory-migrate/ antes.
 *   npx tsx scripts/glory-migrate.ts --dry   |   npx tsx scripts/glory-migrate.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

const VARIANTS = [
  { id: 'glory:dark-seal', item: 'Sello Oscuro', description: 'Gloria (Sello oscuro): cargas por asesinatos/asistencias; AP por carga. Cargas permanentes (ficha).' },
  { id: 'glory:mejai', item: 'Robaalmas de Mejai', description: 'Gloria (Mejai): cargas por asesinatos/asistencias; AP por carga. Cargas permanentes (ficha).' },
];
const PLAYER = 'Samael';
const MIGRATE: { from: string[]; to: string }[] = [
  { from: ['item:Lagrima de la Diosa', 'item:Lagrima de la diosa'], to: 'effect:manaflow' },
  { from: ['item:Vara de las edades'], to: 'effect:timeless' },
];
const DUPLICATE = 'item:Lagrima de la diosa';

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const fx = db.collection<{ _id: string; bonus?: unknown; description?: string }>('namedEffectDescriptions');
  const items = db.collection('items');
  const players = db.collection('players');
  if (!dry) {
    const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-glory-migrate`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['namedEffectDescriptions', 'items', 'players']) {
      const all = await db.collection(name).find({}).toArray();
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(all, null, 2), 'utf8');
      console.log(`Copia ${name}: ${all.length} docs`);
    }
    console.log(`Copia: ${dir}`);
  }
  const now = new Date().toISOString();
  const p = dry ? '[dry] ' : '';

  // 1. Gloria
  const glory = await fx.findOne({ _id: 'glory' });
  if (!glory?.bonus) throw new Error('glory no tiene config');
  const bonus = parseEffectBonusConfig(glory.bonus);
  for (const variant of VARIANTS) {
    const existing = await fx.findOne({ _id: variant.id });
    console.log(`${p}${variant.id}: ${existing ? 'ya existía → bonus sobrescrito' : 'nuevo'} ${JSON.stringify(bonus)}`);
    if (!dry) await fx.updateOne({ _id: variant.id }, { $set: { bonus, ...(existing?.description?.trim() ? {} : { description: variant.description }), updatedAt: now } }, { upsert: true });
    const item = await items.findOne({ nombre: variant.item });
    if (!item) { console.log(`  ¡ítem ${variant.item} no encontrado!`); continue; }
    const list = ((item.namedEffects ?? []) as string[]).map(id => (id === 'glory' ? variant.id : id));
    console.log(`${p}  ${variant.item}: namedEffects ${JSON.stringify(item.namedEffects)} → ${JSON.stringify(list)}`);
    if (!dry) await items.updateOne({ _id: item._id }, { $set: { namedEffects: list, updatedAt: now } });
  }

  // 2. Samael
  const player = await players.findOne({ name: PLAYER });
  if (!player) throw new Error(`${PLAYER} no encontrado`);
  const stacks = (player.stacks ?? {}) as Record<string, number>;
  const set: Record<string, number> = {};
  for (const { from, to } of MIGRATE) {
    const values = from.map(key => stacks[key]).filter((n): n is number => typeof n === 'number');
    if (!values.length) continue;
    set[`stacks.${to}`] = Math.max(...values, stacks[to] ?? 0);
  }
  console.log(`${p}${PLAYER}: stacks antes ${JSON.stringify(stacks)} · $set ${JSON.stringify(set)} · $unset stacks.${DUPLICATE}`);
  if (!dry) {
    await players.updateOne({ _id: player._id }, { $set: set });
    const after = await players.findOne({ _id: player._id });
    const copied = Object.entries(set).every(([k, v]) => (after?.stacks as Record<string, number>)?.[k.slice(7)] === v);
    if (copied && DUPLICATE in stacks) await players.updateOne({ _id: player._id }, { $unset: { [`stacks.${DUPLICATE}`]: '' } });
    console.log(`  copiado=${copied} · después ${JSON.stringify((await players.findOne({ _id: player._id }))?.stacks)}`);
  }

  // 3. Yun Tal
  const yun = await items.findOne({ nombre: 'Flechas de los Yun Tal' });
  const text = String((yun?.efecto as Record<string, unknown> | undefined)?.pasiva ?? '');
  if (yun && text.includes('0.16')) {
    const next = text.replace('0.16', '0.2');
    console.log(`${p}Yun Tal pasiva: «${text.split('\n')[0]}» → «${next.split('\n')[0]}»`);
    if (!dry) await items.updateOne({ _id: yun._id }, { $set: { 'efecto.pasiva': next, updatedAt: now } });
  } else console.log(`Yun Tal: no hay 0.16 en el texto (${JSON.stringify(text.slice(0, 120))})`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
