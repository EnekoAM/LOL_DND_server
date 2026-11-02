import type { Db, Document } from 'mongodb';
import { DEFAULT_LOOT_RULES } from '../src/lootItems';
import { LOOT_RULE_KEYS } from '../src/validate';

export type LootRulesResult = 'escritas' | 'completadas' | 'conservadas';

/**
 * Guarda las reglas de botín por defecto en loot/tables.
 * Sin force solo rellena las claves que faltan (rolls, Drop…, wildCard); con force las sobrescribe todas.
 * No toca otros campos del documento.
 */
export async function writeLootRules(db: Db, force: boolean): Promise<LootRulesResult> {
  const loot = db.collection<Document & { _id: string }>('loot');
  const current = await loot.findOne({ _id: 'tables' });
  const missing = LOOT_RULE_KEYS.filter(key => force || current?.[key] === undefined);
  if (missing.length === 0) return 'conservadas';

  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of missing) set[key] = DEFAULT_LOOT_RULES[key];
  await loot.updateOne({ _id: 'tables' }, { $set: set }, { upsert: true });
  return missing.length === LOOT_RULE_KEYS.length ? 'escritas' : 'completadas';
}
