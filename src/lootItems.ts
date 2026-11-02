import type { LootRules } from './validate';

export type LootRarity = 'basico' | 'epico' | 'legendario';

export type LootRollEntry = {
  name: string;
  coste: number;
  normalizado: number;
  'Probabilidad(0,1)': number;
  'Probabilidad(acumulada)': number;
};

const RARITIES: LootRarity[] = ['basico', 'epico', 'legendario'];

/**
 * Valores iniciales de las reglas de botín (spawns, subidas de rareza y "Lo que quieras").
 * En tiempo de ejecución se leen de Mongo (loot/tables); esto solo lo usan
 * scripts/migrate-loot-rules.ts y scripts/seed.ts para rellenar el documento.
 *
 * wildCard: parte fija de "Lo que quieras". El resto se reparte con peso 1/coste.
 * En épico el JSON antiguo guardaba 0.046, pero la tirada miraba la acumulada 0.99, así que salía un 1%.
 */
export const DEFAULT_LOOT_RULES: LootRules = {
  rolls: [
    { type: 'Basico', prob: 50 },
    { type: 'Epico', prob: 75 },
  ],
  'Drop basico': [
    { item: 'Prob. basico', prob: 92 },
    { item: 'Prob. epico', prob: 7 },
    { item: 'Prob. legendario', prob: 1 },
  ],
  'Drop epico': [
    { item: 'Prob. basico', prob: 33 },
    { item: 'Prob. epico', prob: 62 },
    { item: 'Prob. legendario', prob: 5 },
  ],
  'Drop legendario': [
    { item: 'Prob. basico', prob: 0 },
    { item: 'Prob. epico', prob: 30 },
    { item: 'Prob. legendario', prob: 70 },
  ],
  wildCard: {
    basico: 0.015,
    epico: 0.01,
    legendario: 0.0075,
  },
};

const WILD_CARD = 'Lo que quieras';

function plainKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function positiveCost(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

type PricedItem = { name: string; coste: number };

/**
 * Arma las tres tablas de botín a partir del catálogo. Un ítem entra si su rareza es básica, épica o legendaria y tiene coste.
 * wildCardProb viene de las reglas guardadas en Mongo (loot/tables.wildCard).
 */
export function buildLootItems(
  catalog: { nombre?: unknown; rareza?: unknown; coste?: unknown }[],
  wildCardProb: Record<LootRarity, number>,
): Record<LootRarity, LootRollEntry[]> {
  const grouped: Record<LootRarity, PricedItem[]> = { basico: [], epico: [], legendario: [] };
  const seen: Record<LootRarity, Set<string>> = {
    basico: new Set(),
    epico: new Set(),
    legendario: new Set(),
  };

  for (const item of catalog) {
    const rarity = plainKey(item.rareza);
    if (rarity !== 'basico' && rarity !== 'epico' && rarity !== 'legendario') continue;
    const name = typeof item.nombre === 'string' ? item.nombre.trim() : '';
    const key = plainKey(name);
    if (!name || key === plainKey(WILD_CARD) || seen[rarity].has(key)) continue;
    const coste = positiveCost(item.coste);
    if (coste <= 0) continue;
    seen[rarity].add(key);
    grouped[rarity].push({ name, coste });
  }

  const tables = {} as Record<LootRarity, LootRollEntry[]>;
  for (const rarity of RARITIES) {
    const priced = grouped[rarity].sort(
      (a, b) => a.coste - b.coste || a.name.localeCompare(b.name, 'es'),
    );
    const wildProb = priced.length > 0 ? wildCardProb[rarity] : 1;
    const share = 1 - wildProb;
    const weightSum = priced.reduce((sum, item) => sum + 1 / item.coste, 0);
    let accumulated = 0;
    const entries: LootRollEntry[] = priced.map(item => {
      const normalizado = 1 / item.coste;
      const probability = weightSum > 0 ? (normalizado / weightSum) * share : 0;
      const entry: LootRollEntry = {
        name: item.name,
        coste: item.coste,
        normalizado,
        'Probabilidad(0,1)': probability,
        'Probabilidad(acumulada)': accumulated,
      };
      accumulated += probability;
      return entry;
    });
    entries.push({
      name: WILD_CARD,
      coste: 0,
      normalizado: 0,
      'Probabilidad(0,1)': wildProb,
      'Probabilidad(acumulada)': priced.length > 0 ? accumulated : 0,
    });
    tables[rarity] = entries;
  }
  return tables;
}
