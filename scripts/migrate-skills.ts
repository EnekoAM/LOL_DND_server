import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';

/**
 * Añade sheet.skills = {} (ninguna competencia) a los players con ficha que aún no lo tienen.
 * Idempotente: no toca las competencias ya marcadas.
 */
async function migrate() {
  const db = await getDb();
  const result = await db.collection('players').updateMany(
    { sheet: { $type: 'object' }, 'sheet.skills': { $exists: false } },
    { $set: { 'sheet.skills': {}, updatedAt: new Date().toISOString() } },
  );
  console.log(`Base "${db.databaseName}": sheet.skills añadido a ${result.modifiedCount} jugador(es).`);
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