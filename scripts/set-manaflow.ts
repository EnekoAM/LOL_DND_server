/**
 * Flujo de maná (manaflow), como lo dio Eneko: empieza el combate con 4 cargas (máx. 4, recarga 1 cada 4 t.);
 * dañar a un enemigo con una habilidad gasta 1 y da 1 carga permanente (ficha): +1 maná máx. por carga, máx. 120.
 * Compartido por Lágrima / Manamune / Arcángel (mismo id). Copia namedEffectDescriptions en backups/<fecha>-manaflow/ antes.
 *   npx tsx scripts/set-manaflow.ts --dry   |   npx tsx scripts/set-manaflow.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

const ID = 'manaflow';
const DESCRIPTION = 'Empieza el combate con 4 cargas (recarga 1 cada 4 t., máx. 4). Dañar a un enemigo con una habilidad gasta 1 y da 1 acumulación permanente de Flujo de maná: +1 de maná máximo cada una (máx. 120).';
const BONUS = {
  charges: { start: 4, max: 4, every: 4 },
  rules: [{ trigger: 'on-ability-hit', kind: 'stat', stat: 'mana', flat: 1, maxStacks: 120, permanent: true }],
};

async function main() {
  const dry = process.argv.includes('--dry');
  const bonus = parseEffectBonusConfig(BONUS);
  const db = await getDb();
  const col = db.collection<{ _id: string; bonus?: unknown; description?: string }>('namedEffectDescriptions');
  const doc = await col.findOne({ _id: ID });
  console.log(`antes: ${JSON.stringify(doc)}`);
  console.log(`${dry ? '[dry] ' : ''}${ID}: bonus → ${JSON.stringify(bonus)}${doc?.description?.trim() ? ' · descripción suya: no se toca' : ' · descripción nueva'}`);
  if (dry) process.exit(0);
  const all = await col.find({}).toArray();
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-manaflow`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} docs)`);
  await col.updateOne({ _id: ID }, { $set: { bonus, ...(doc?.description?.trim() ? {} : { description: DESCRIPTION }), updatedAt: new Date().toISOString() } }, { upsert: true });
  console.log(`después: ${JSON.stringify(await col.findOne({ _id: ID }))}`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
