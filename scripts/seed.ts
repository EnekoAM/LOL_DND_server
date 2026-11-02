import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';
import { writeLootRules } from './lootRules';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath: string): unknown {
  const text = readFileSync(join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function singleDoc(value: unknown, file: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') {
    throw new Error(`${file} tiene que ser una lista con un solo documento`);
  }
  return value[0] as Record<string, unknown>;
}

async function seed() {
  const resetParty = process.argv.includes('--reset-party');
  const db = await getDb();

  // Reglas de botín: mismas que npm run migrate:loot (no pisa las ya guardadas).
  const lootResult = await writeLootRules(db, false);
  console.log(`Base "${db.databaseName}": reglas de botín ${lootResult}.`);

  if (!existsSync(join(root, 'src/json/party.json'))) {
    console.log('Grupo: no hay src/json/party.json, se omite');
    return;
  }
  const partyDoc = singleDoc(readJson('src/json/party.json'), 'party.json');
  const party = db.collection<Document & { _id: string }>('party');

  if (resetParty) {
    await party.replaceOne({ _id: 'current' }, { ...partyDoc, _id: 'current' }, { upsert: true });
  } else {
    await party.updateOne(
      { _id: 'current' },
      { $setOnInsert: { ...partyDoc, _id: 'current' } },
      { upsert: true },
    );
  }

  console.log(resetParty ? 'Grupo: reiniciado con party.json' : 'Grupo: conservado si ya existía');
}

loadEnv();
seed()
  .catch(error => {
    logError(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
