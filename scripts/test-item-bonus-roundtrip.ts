/**
 * Comprueba que los bonus de namedEffectDescriptions redondean el editor
 * (normalizeBonusConfig es idempotente) y que el parser del servidor los acepta.
 * Solo lectura. No escribe en la base.
 *   npx tsx scripts/test-item-bonus-roundtrip.ts
 */
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';
import { normalizeBonusConfig } from '../../web/src/data/effectBonus';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const docs = await (await getDb()).collection('namedEffectDescriptions').find({}).toArray();
  let ok = 0;
  let missing = 0;
  const failures: string[] = [];
  for (const doc of docs) {
    if (!doc.bonus || typeof doc.bonus !== 'object') { missing += 1; continue; }
    const id = String(doc._id);
    try {
      const parsed = parseEffectBonusConfig(doc.bonus);
      const once = normalizeBonusConfig(parsed);
      const twice = once ? normalizeBonusConfig(once) : undefined;
      if (!once) { failures.push(`${id}: normalize vacía tras parse`); continue; }
      if (!same(once, twice)) { failures.push(`${id}: normalize no es idempotente`); continue; }
      const again = parseEffectBonusConfig(once);
      const third = normalizeBonusConfig(again);
      if (!same(once, third)) { failures.push(`${id}: parse→normalize no cierra el círculo`); continue; }
      ok += 1;
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`Bonus con config: ${ok + failures.length} · OK ${ok} · fallos ${failures.length} · docs sin bonus ${missing} · total docs ${docs.length}`);
  for (const line of failures) console.log('FAIL', line);
  process.exit(failures.length ? 1 : 0);
}

main().catch(error => { console.error(error); process.exit(1); });
