import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';
import { writeLootRules } from './lootRules';

/**
 * Copia las reglas de botín (rolls, Drop básico/épico/legendario y "Lo que quieras")
 * de server/lootItems.ts al documento loot/tables.
 * Por defecto conserva las reglas que ya estén guardadas. Con --force las sobrescribe.
 */
async function migrate() {
  const force = process.argv.includes('--force');
  const db = await getDb();
  const result = await writeLootRules(db, force);
  if (result === 'conservadas') console.log('Reglas de botín: ya existían (usa --force para sobrescribir)');
  else console.log(`Reglas de botín: ${result} en loot/tables`);
  console.log(`Base "${db.databaseName}": reglas de botín migradas.`);
}

loadEnv();
migrate()
  .catch(error => {
    logError(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
