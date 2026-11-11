import type { RoleStatLine as StatLine, RoleTable } from '../src/validate';
import { extendLevels } from './roleExtend';

/** Niveles de cada tabla de rol (1-20). Las filas escritas abajo llegan al 18; el resto se prolonga con extendLevels(). */
export const ROLE_MAX_LEVEL = 20;

/**
 * Tablas de rol × nivel que antes vivían en src/features/calculos/roleTables.ts.
 * Solo las usa scripts/migrate-roles.ts para rellenar la colección roles;
 * en tiempo de ejecución la app las lee de Mongo (GET /api/roles).
 */

/**
 * AC 10, MR 5 de relleno (cada rol pone las suyas con withDefense), crítico 0 / 1,5 y el resto de columnas de porcentaje a 0.
 * HP: se calcula con withHp() a partir de la vida base de cada rol.
 * Cambian maná, AD, AP, SPE, Attacks y Abilities.
 */
function row(
  mana: number,
  ad: string,
  ap: string,
  spe: number,
  atkSpe: number,
  abSpe: number,
): StatLine {
  return {
    hp: 0, // se calcula después con withHp()
    ac: 10,
    mr: 5,
    mana,
    ad,
    ap,
    critChance: 0,
    critDamage: 1.5,
    spe,
    atkSpe,
    atkSpePct: 0,
    abSpe,
    abSpePct: 0,
    lethality: 0,
    magicPen: 0,
    armorPenPct: 0,
    magicPenPct: 0,
    // Solo las dan los ítems: 0 en todos los roles y niveles.
    healShieldPct: 0,
    tenacityPct: 0,
    slowResistPct: 0,
    lifeStealPct: 0,
    omnivampPct: 0,
    range: 0,
    healthRegen: 0,
    manaRegen: 0,
  };
}


/**
 * Vida automática: solo hace falta la vida base de cada rol (la del nivel 1 sin escalar).
 *   vida bruta = base × nivel (+ bonos de tramo opcionales en los niveles 6, 11 y 16)
 *   vida final = (vida bruta + base) × (HP_RAMP_START + (nivel − 1) × HP_RAMP_STEP)
 * Ajusta la dureza global tocando HP_RAMP_START y HP_RAMP_STEP.
 */
const HP_RAMP_START = 1.25; // multiplicador en nivel 1
const HP_RAMP_STEP = 0.044; // +0,044 por nivel → ≈ ×2 en nivel 18, ×2,09 en el 20
const HP_TIER_STARTS = [6, 11, 16];

function hpAt(base: number, level: number, tierBonus: number[] = []): number {
  const extra = HP_TIER_STARTS.reduce(
    (sum, start, i) => (level >= start ? sum + (tierBonus[i] ?? 0) : sum),
    0,
  );
  const raw = base * level + extra;
  return Math.round((raw + base) * (HP_RAMP_START + (level - 1) * HP_RAMP_STEP));
}

/**
 * Prolonga la tabla hasta ROLE_MAX_LEVEL (misma progresión que las últimas filas)
 * y rellena el hp de cada nivel a partir de la vida base. tierBonus: incrementos extra en los niveles 6, 11 y 16.
 */
function withHp(levels: StatLine[], base: number, tierBonus: number[] = []): StatLine[] {
  return extendLevels(levels, ROLE_MAX_LEVEL).map((level, index) => ({ ...level, hp: hpAt(base, index + 1, tierBonus) }));
}

const mago: StatLine[] = [
  row(25, '1d2', '2d2', 6, 1, 2),
  row(40, '1d2', '2d4', 6, 1, 2),
  row(55, '1d2', '3d4', 6, 1, 2),
  row(70, '1d2', '3d4', 7, 1, 3),
  row(85, '1d2', '4d4', 7, 1, 3),
  row(100, '2d2', '4d6', 7, 1, 3),
  row(115, '2d2', '4d6+1d4', 8, 1, 3),
  row(130, '2d2', '4d6+2d4', 8, 1, 3),
  row(145, '2d2', '5d6+2d4', 8, 1, 3),
  row(160, '2d2', '5d6+2d4', 9, 1, 4),
  row(175, '2d4', '5d6+3d4', 9, 1, 4),
  row(190, '2d4', '6d6+3d4', 9, 1, 4),
  row(205, '2d4', '6d6+4d4', 10, 1, 4),
  row(220, '2d4', '6d6+5d4', 10, 1, 4),
  row(235, '2d4', '6d6+6d4', 10, 1, 4),
  row(250, '4d4', '6d6+6d4', 11, 1, 5),
  row(265, '4d4', '6d6+7d4', 11, 1, 5),
  row(280, '4d4', '6d6+8d4', 11, 1, 5),
];

const asesinoAd: StatLine[] = [
  row(10, '1d4', '1d2', 8, 1, 1),
  row(20, '2d4', '1d2', 8, 1, 1),
  row(30, '2d4+1d2', '1d2', 8, 1, 1),
  row(40, '2d4+2d2', '1d2', 9, 1, 1),
  row(50, '3d4+2d2', '1d2', 9, 1, 1),
  row(60, '3d4+2d2', '2d2', 9, 1, 2),
  row(70, '3d4+3d2', '2d2', 10, 1, 2),
  row(80, '3d4+4d2', '2d2', 10, 1, 2),
  row(90, '4d4+4d2', '2d2', 10, 1, 2),
  row(100, '4d4+5d2', '2d2', 11, 1, 2),
  row(110, '5d4+5d2', '2d4', 11, 1, 2),
  row(120, '5d4+6d2', '2d4', 11, 1, 2),
  row(130, '5d4+7d2', '2d4', 12, 1, 2),
  row(140, '5d4+8d2', '2d4', 12, 1, 2),
  row(150, '5d4+9d2', '2d4', 12, 1, 2),
  row(160, '5d4+9d2', '4d4', 13, 1, 3),
  row(170, '5d4+10d2', '4d4', 13, 1, 3),
  row(180, '5d4+10d2+1', '4d4', 13, 1, 3),
];

const asesinoAp: StatLine[] = [
  row(20, '1d2', '1d2', 8, 1, 2),
  row(30, '1d2', '2d2', 8, 1, 2),
  row(40, '2d2', '2d2', 8, 1, 2),
  row(50, '2d2', '3d2', 9, 1, 2),
  row(60, '2d2', '1d4+3d2', 9, 1, 2),
  row(70, '3d2', '1d4+3d2', 9, 1, 2),
  row(80, '3d2', '1d4+4d2', 10, 1, 2),
  row(90, '3d2', '1d4+4d2', 10, 1, 3),
  row(100, '4d2', '1d4+4d2', 10, 1, 3),
  row(110, '4d2', '2d4+4d2', 11, 1, 3),
  row(120, '1d4+4d2', '2d4+5d2', 11, 1, 3),
  row(130, '1d4+4d2', '2d4+6d2', 11, 1, 3),
  row(140, '1d4+4d2', '2d4+7d2', 12, 1, 3),
  row(150, '1d4+5d2', '2d4+7d2', 12, 1, 3),
  row(160, '1d4+5d2', '2d4+8d2', 12, 1, 3),
  row(170, '2d4+5d2', '2d4+8d2', 13, 1, 4),
  row(180, '2d4+5d2', '2d4+9d2', 13, 1, 4),
  row(190, '2d4+5d2', '2d4+10d2', 13, 1, 4),
];

const tirador: StatLine[] = [
  row(15, '2d2', '1d2', 6, 1, 1),
  row(20, '3d2', '1d2', 6, 1, 1),
  row(25, '3d4', '1d2', 6, 2, 1),
  row(30, '4d4', '1d2', 7, 2, 1),
  row(35, '4d4+1d2', '1d2', 7, 2, 1),
  row(40, '5d4+1d2', '2d2', 7, 2, 1),
  row(45, '5d4+2d2', '2d2', 8, 2, 1),
  row(50, '5d4+3d2', '2d2', 8, 2, 1),
  row(55, '5d4+4d2', '2d2', 8, 2, 1),
  row(60, '6d4+4d2', '2d2', 9, 2, 1),
  row(65, '6d4+5d2', '2d4', 9, 3, 1),
  row(70, '6d4+6d2', '2d4', 9, 3, 1),
  row(75, '7d4+6d2', '2d4', 10, 3, 1),
  row(80, '8d4+6d2', '2d4', 10, 3, 1),
  row(85, '9d4+6d2', '2d4', 10, 3, 1),
  row(90, '1d6+9d4+6d2', '4d4', 11, 3, 1),
  row(95, '1d6+10d4+6d2', '4d4', 11, 3, 1),
  row(100, '1d6+10d4+7d2', '4d4', 11, 3, 1),
];

const support: StatLine[] = [
  row(35, '1d2', '1d2', 6, 1, 3),
  row(50, '1d2', '1d2', 6, 1, 3),
  row(65, '2d2', '2d2', 6, 1, 3),
  row(80, '2d2', '2d2', 7, 1, 4),
  row(95, '2d2', '2d2', 7, 1, 4),
  row(110, '3d2', '3d2', 7, 1, 4),
  row(125, '3d2', '3d2', 8, 1, 4),
  row(140, '3d2', '3d2', 8, 1, 4),
  row(155, '4d2', '4d2', 8, 1, 4),
  row(170, '4d2', '4d2', 9, 1, 5),
  row(185, '1d4+4d2', '1d4+4d2', 9, 1, 5),
  row(200, '1d4+4d2', '1d4+4d2', 9, 1, 5),
  row(215, '1d4+4d2', '1d4+4d2', 10, 1, 5),
  row(230, '1d4+5d2', '1d4+5d2', 10, 1, 5),
  row(245, '1d4+5d2', '1d4+5d2', 10, 1, 5),
  row(260, '2d4+5d2', '2d4+5d2', 11, 1, 6),
  row(275, '2d4+5d2', '2d4+5d2', 11, 1, 6),
  row(290, '2d4+5d2', '2d4+5d2', 11, 1, 6),
];

/**
 * AC y MR base del rol en nivel 1-5; +1 a las dos en los niveles 6, 11 y 16 (16-20 = base + 3).
 */
const DEFENSE_TIER_STARTS = [6, 11, 16];

function withDefense(levels: StatLine[], ac: number, mr: number): StatLine[] {
  return levels.map((level, index) => {
    const tier = DEFENSE_TIER_STARTS.filter(start => index + 1 >= start).length;
    return { ...level, ac: ac + tier, mr: mr + tier };
  });
}

type Bands = [number, number, number, number];

/**
 * Attacks (atkSpe) y Abilities (abSpe) por tramos de nivel 1-5 / 6-10 / 11-15 / 16-20.
 * null = deja los valores por nivel de la tabla de arriba.
 */
function withActions(levels: StatLine[], atk: Bands | null, ab: Bands | null): StatLine[] {
  return levels.map((level, index) => {
    const tier = DEFENSE_TIER_STARTS.filter(start => index + 1 >= start).length;
    return {
      ...level,
      ...(atk ? { atkSpe: atk[tier] } : {}),
      ...(ab ? { abSpe: ab[tier] } : {}),
    };
  });
}

const luchadorAdMana = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

const luchadorAp: StatLine[] = [
  row(10, '1d2', '1d2', 6, 1, 1),
  row(20, '1d2', '2d2', 6, 1, 1),
  row(30, '2d2', '2d2', 6, 1, 2),
  row(40, '2d2', '3d2', 7, 1, 2),
  row(50, '3d2', '1d4+1d2', 7, 1, 2),
  row(60, '3d2', '1d4+2d2', 7, 1, 2),
  row(70, '3d2', '1d4+3d2', 8, 1, 2),
  row(80, '4d2', '2d4+1d2', 8, 1, 2),
  row(90, '4d2', '2d4+2d2', 8, 1, 2),
  row(100, '4d2', '2d4+2d2', 9, 1, 3),
  row(110, '4d2', '2d4+2d2', 9, 1, 3),
  row(120, '4d2', '2d4+3d2', 9, 1, 3),
  row(130, '4d2', '2d4+4d2', 10, 1, 3),
  row(140, '4d2', '2d4+5d2', 10, 1, 3),
  row(150, '4d2', '2d4+6d2', 10, 1, 3),
  row(160, '4d4', '1d6+2d4+6d2', 11, 1, 3),
  row(170, '4d4', '1d6+2d4+7d2', 11, 1, 3),
  row(180, '4d4', '1d6+2d4+8d2', 11, 1, 3),
];

const tanque: StatLine[] = [
  row(5, '1d2', '1d2', 6, 1, 1),
  row(10, '1d2', '1d2', 6, 1, 1),
  row(15, '1d2', '1d2', 6, 1, 1),
  row(20, '1d2', '1d2', 7, 1, 1),
  row(25, '1d2', '1d2', 7, 1, 1),
  row(30, '2d2', '2d2', 7, 1, 1),
  row(35, '2d2', '2d2', 8, 1, 1),
  row(40, '2d2', '2d2', 8, 1, 1),
  row(45, '2d2', '2d2', 8, 1, 1),
  row(50, '2d2', '2d2', 9, 1, 1),
  row(55, '2d4', '2d4', 9, 1, 1),
  row(60, '2d4', '2d4', 9, 1, 1),
  row(65, '2d4', '2d4', 10, 1, 1),
  row(70, '2d4', '2d4', 10, 1, 1),
  row(75, '2d4', '2d4', 10, 1, 1),
  row(80, '4d4', '4d4', 11, 1, 1),
  row(85, '4d4', '4d4', 11, 1, 1),
  row(90, '4d4', '4d4', 11, 1, 1),
];

export const DEFAULT_ROLE_TABLES: RoleTable[] = [
  { id: 'mago', name: 'Mago', levels: withDefense(withHp(mago, 8), 9, 5) },
  { id: 'asesino-ad', name: 'Asesino AD', levels: withActions(withDefense(withHp(asesinoAd, 9), 10, 5), [1, 2, 2, 2], [2, 3, 3, 4]) },
  { id: 'asesino-ap', name: 'Asesino AP', levels: withActions(withDefense(withHp(asesinoAp, 9), 10, 5), [1, 1, 2, 2], [2, 3, 4, 4]) },
  { id: 'tirador', name: 'Tirador', levels: withActions(withDefense(withHp(tirador, 9), 9, 5), null, [1, 1, 2, 2]) },
  { id: 'support', name: 'Support', levels: withActions(withDefense(withHp(support, 10), 10, 5), null, [2, 3, 4, 5]) },
  {
    id: 'luchador-ad',
    name: 'Luchador AD',
    levels: withDefense(
      withHp(
        tirador.map((level, index) => ({ ...level, mana: luchadorAdMana[index] })),
        11,
      ),
      11,
      6,
    ),
  },
  { id: 'luchador-ap', name: 'Luchador AP', levels: withDefense(withHp(luchadorAp, 11), 11, 6) },
  { id: 'tanque', name: 'Tanque', levels: withActions(withDefense(withHp(tanque, 13, [10, 15, 20]), 12, 6), null, [1, 1, 2, 2]) },
];
