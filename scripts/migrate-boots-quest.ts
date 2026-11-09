import type { Document } from 'mongodb';
import { closeDb, getDb } from '../src/db';
import { logError } from '../src/errors';
import { loadEnv } from '../src/env';

/**
 * Botas fuera de compra (código) + ítem de misión para las mejoras finales (tochas).
 * Idempotente: crea Insignia del Viajero si falta y asegura que las tochas la pidan.
 */
const QUEST_ITEM = 'Insignia del Viajero';

const TOCHAS: { result: string; fromBoots: string }[] = [
  { result: 'Lucidez carmesi', fromBoots: 'Botas jonias de lucidez' },
  { result: 'Marcha veloz', fromBoots: 'Botas de rapidez' },
  { result: 'Botas de lanza hechizos', fromBoots: 'Botas de hechicero' },
  { result: 'Grebas de metal', fromBoots: 'Grebas de berserker' },
  { result: 'Avance blindado', fromBoots: 'Botas blindadas' },
  { result: 'Trituradoras encadenadas', fromBoots: 'Botas de mercurio' },
  { result: 'Viaje inmortal', fromBoots: 'Grebas Codiciosas' },
];

const CI = { locale: 'es', strength: 2 } as const;

const emptyStats = {
  HP: 0, AC: 0, MR: 0, MANA: 0, AD: 0, AP: 0,
  CRIT_CHANCE: 0, CRIT_DAMAGE: 0, SPE: 0, 'ATK spe': 0,
  'Ab haste': 0, LETHALITY: 0, MAGIC_PEN: 0,
  'Armor pen %': 0, 'Magic pen %': 0,
};

async function migrate() {
  const db = await getDb();
  const items = db.collection<Document>('items');
  const now = new Date().toISOString();

  const existingQuest = await items.findOne({ nombre: QUEST_ITEM }, { collation: CI });
  if (!existingQuest) {
    await items.insertOne({
      nombre: QUEST_ITEM,
      rareza: 'Inicial',
      stats: emptyStats,
      efecto: {
        pasiva: 'Trofeo de misión. Hace falta para craftear las botas mejoradas (tochas).',
        activa: '-',
      },
      cantidad: 0,
      imagen: '',
      craftsTo: TOCHAS.map(t => t.result),
      craftsFrom: [],
      coste: 0,
      updatedAt: now,
    });
    console.log(`${QUEST_ITEM}: creada (qty 0, rareza Inicial)`);
  } else {
    await items.updateOne(
      { _id: existingQuest._id },
      {
        $set: {
          craftsTo: TOCHAS.map(t => t.result),
          'efecto.pasiva': 'Trofeo de misión. Hace falta para craftear las botas mejoradas (tochas).',
          updatedAt: now,
        },
      },
    );
    console.log(`${QUEST_ITEM}: ya existía, craftsTo actualizado`);
  }

  for (const { result, fromBoots } of TOCHAS) {
    const doc = await items.findOne({ nombre: result }, { collation: CI });
    if (!doc) {
      console.log(`${result}: no existe, se omite`);
      continue;
    }
    const recipe = [fromBoots, QUEST_ITEM];
    await items.updateOne(
      { _id: doc._id },
      { $set: { craftsFrom: recipe, updatedAt: now } },
    );
    console.log(`${result}: craftsFrom = ${recipe.join(' + ')}`);
  }

  // Arregla el nombre viejo "Grebas glotonas" si quedó colgado.
  const viaje = await items.findOne({ nombre: 'Viaje inmortal' }, { collation: CI });
  if (viaje) {
    const from = Array.isArray(viaje.craftsFrom) ? viaje.craftsFrom.map(String) : [];
    if (from.some(n => /gloton/i.test(n))) {
      await items.updateOne(
        { _id: viaje._id },
        { $set: { craftsFrom: ['Grebas Codiciosas', QUEST_ITEM], updatedAt: now } },
      );
      console.log('Viaje inmortal: corregido Grebas glotonas → Grebas Codiciosas');
    }
  }

  // Base Botas también apunta a Grebas Codiciosas.
  const base = await items.findOne({ nombre: 'Botas' }, { collation: CI });
  if (base) {
    const to = Array.isArray(base.craftsTo) ? base.craftsTo.map(String) : [];
    if (!to.some(n => n.toLowerCase() === 'grebas codiciosas')) {
      await items.updateOne(
        { _id: base._id },
        { $set: { craftsTo: [...to, 'Grebas Codiciosas'], updatedAt: now } },
      );
      console.log('Botas: añadido Grebas Codiciosas a craftsTo');
    }
  }

  console.log(`Base "${db.databaseName}": migración de botas/misión lista.`);
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
