/**
 * Activa «Las habilidades también descargan Vigor» (bonus.abilityDischarge) en un efecto / variante.
 * Antes copia namedEffectDescriptions en backups/<fecha>-ability-discharge/. Solo pone bonus.abilityDischarge = true:
 * si el id ya tiene bonus, no toca sus reglas ni tiempos; si no tiene, crea { rules: [], abilityDischarge: true }
 * (la variante sigue usando las reglas del efecto base). Nunca toca description ni onHit.
 *   npx tsx scripts/set-ability-discharge.ts energized:physical [--dry]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';

const EFFECT_ID = /^[a-z0-9-]{1,60}(:[a-z0-9-]{1,30})?$/;

async function main() {
  const id = process.argv[2] ?? '';
  const dry = process.argv.includes('--dry');
  if (!EFFECT_ID.test(id)) throw new Error('Falta el id del efecto (p. ej. energized:physical)');
  const db = await getDb();
  const col = db.collection<{ _id: string; bonus?: Record<string, unknown>; updatedAt?: string }>('namedEffectDescriptions');
  const items = await db.collection('items').find({ namedEffects: id }, { projection: { nombre: 1 } }).toArray();
  const doc = await col.findOne({ _id: id });
  console.log(`${id}: ítems ${items.map(item => item.nombre).join(', ') || '(ninguno)'} · bonus actual ${doc?.bonus ? JSON.stringify(doc.bonus) : '(no)'}`);
  if (dry) { process.exit(0); }
  const all = await col.find({}).toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `${stamp}-ability-discharge`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} docs)`);
  const updatedAt = new Date().toISOString();
  if (doc?.bonus && typeof doc.bonus === 'object') {
    await col.updateOne({ _id: id }, { $set: { 'bonus.abilityDischarge': true, updatedAt } });
  } else {
    await col.updateOne({ _id: id }, { $set: { bonus: { rules: [], abilityDischarge: true }, updatedAt } }, { upsert: true });
  }
  console.log(`+ ${id}: abilityDischarge = true · ahora ${JSON.stringify((await col.findOne({ _id: id }))?.bonus)}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
