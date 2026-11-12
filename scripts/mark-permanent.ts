/**
 * Marca «Cargas permanentes» (rule.permanent) en las reglas de bonus de stat con máx. stacks de estos efectos.
 * Solo la casilla: no cambia valores. Copia namedEffectDescriptions en backups/<fecha>-permanent/ antes.
 *   npx tsx scripts/mark-permanent.ts --dry   |   npx tsx scripts/mark-permanent.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

const IDS = ['glory'];
type Rule = Record<string, unknown> & { kind?: string; maxStacks?: number; appliesTo?: string };
type Doc = { _id: string; bonus?: { rules?: Rule[] } & Record<string, unknown> };

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<Doc>('namedEffectDescriptions');
  if (!dry) {
    const all = await col.find({}).toArray();
    const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-permanent`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
    console.log(`Copia: ${dir} (${all.length} docs)`);
  }
  for (const id of IDS) {
    const doc = await col.findOne({ _id: id });
    if (!doc?.bonus?.rules?.length) { console.log(`${id}: sin reglas, no se toca`); continue; }
    let marked = 0;
    const rules = doc.bonus.rules.map(rule => {
      if (['stat', 'attack-speed', 'move-speed'].includes(String(rule.kind)) && typeof rule.maxStacks === 'number' && (!rule.appliesTo || rule.appliesTo === 'self')) { marked++; return { ...rule, permanent: true }; }
      return rule;
    });
    if (!marked) { console.log(`${id}: ninguna regla de stat con stacks, no se toca`); continue; }
    const bonus = parseEffectBonusConfig({ ...doc.bonus, rules });
    console.log(`${dry ? '[dry] ' : ''}${id}: ${marked} regla(s) → ${JSON.stringify(bonus)}`);
    if (!dry) await col.updateOne({ _id: id }, { $set: { bonus, updatedAt: new Date().toISOString() } });
  }
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
