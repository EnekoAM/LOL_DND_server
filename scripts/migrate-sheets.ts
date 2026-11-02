import type { Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';
import type { PlayerSheet } from '../src/validate';

/**
 * Fichas que antes vivían en src/features/calculos/playerSheets.ts.
 * Por defecto solo rellena `sheet` en los players que aún no la tienen.
 * Con --force sobrescribe las fichas ya guardadas.
 */
const SHEETS: Record<string, PlayerSheet> = {
  Zeraf: {
    roleId: 'asesino-ad',
    extra: { mana: 5 },
    scores: {
      strength: 8,
      dexterity: 16,
      constitution: 14,
      intelligence: 8,
      wisdom: 8,
      charisma: 15,
    },
  },
  Samael: { roleId: 'mago' },
  Combatiente: { roleId: 'luchador-ad' },
};

const CI = { locale: 'es', strength: 2 } as const;

async function migrate() {
  const force = process.argv.includes('--force');
  const db = await getDb();
  const players = db.collection<Document & { name: string }>('players');

  for (const [name, sheet] of Object.entries(SHEETS)) {
    const filter = force ? { name } : { name, sheet: { $exists: false } };
    const result = await players.updateOne(
      filter,
      { $set: { sheet, updatedAt: new Date().toISOString() } },
      { collation: CI },
    );
    if (result.modifiedCount) console.log(`${name}: ficha guardada`);
    else if (await players.countDocuments({ name }, { collation: CI })) console.log(`${name}: ya tenía ficha (usa --force para sobrescribir)`);
    else console.log(`${name}: no existe en players, se omite`);
  }
  console.log(`Base "${db.databaseName}": fichas migradas.`);
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
