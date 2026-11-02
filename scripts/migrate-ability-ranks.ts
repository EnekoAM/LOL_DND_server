import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';
import { reconcileAbilityRanks } from '../src/store';

/**
 * Rellena players.abilityRanks ({ H1, H2, H3, R }, 0 si faltan) y players.unassignedPoints
 * (= nivel del grupo − puntos gastados). Idempotente: solo escribe los jugadores que cambian.
 */
async function migrate() {
  const db = await getDb();
  const changed = await reconcileAbilityRanks();
  console.log(`Base "${db.databaseName}": rangos de habilidad al día (${changed} jugador(es) actualizados).`);
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
