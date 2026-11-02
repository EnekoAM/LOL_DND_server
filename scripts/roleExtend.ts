import type { RoleStatLine as StatLine } from '../src/validate';

/**
 * Prolonga una tabla de rol × nivel hasta `target` niveles siguiendo la progresión
 * de las dos últimas filas: los números suman el mismo incremento y los dados
 * ("6d6+8d4", "5d4+10d2+1") suman el mismo número de dados por tipo.
 * Si una columna no cambia entre las dos últimas filas, se queda igual.
 */

type Dice = Map<string, number>; // 'd6' → 6d6, 'flat' → +N

const DICE_TERM = /^(\d+)d(\d+)$/;

function parseDice(value: string): Dice | undefined {
  const dice: Dice = new Map();
  for (const raw of value.replace(/\s+/g, '').split('+')) {
    const term = DICE_TERM.exec(raw);
    if (term) {
      const key = `d${term[2]}`;
      dice.set(key, (dice.get(key) ?? 0) + Number(term[1]));
    } else if (/^\d+$/.test(raw)) {
      dice.set('flat', (dice.get('flat') ?? 0) + Number(raw));
    } else {
      return undefined;
    }
  }
  return dice;
}

function formatDice(dice: Dice): string {
  const sides = [...dice.keys()]
    .filter(key => key !== 'flat')
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const parts = sides.filter(key => (dice.get(key) ?? 0) > 0).map(key => `${dice.get(key)}${key}`);
  const flat = dice.get('flat') ?? 0;
  if (flat > 0) parts.push(String(flat));
  return parts.join('+') || '0';
}

function nextDice(prev: string, last: string): string {
  const a = parseDice(prev);
  const b = parseDice(last);
  if (!a || !b) return last;
  const next: Dice = new Map();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const value = (b.get(key) ?? 0) + ((b.get(key) ?? 0) - (a.get(key) ?? 0));
    if (value > 0) next.set(key, value);
  }
  return formatDice(next);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fila siguiente a partir de las tres últimas (la vida acelera: usa la segunda diferencia). */
function nextLine(lines: StatLine[]): StatLine {
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2] ?? last;
  const before = lines[lines.length - 3] ?? prev;
  const next = {} as StatLine;
  for (const key of Object.keys(last) as (keyof StatLine)[]) {
    const a = prev[key];
    const b = last[key];
    if (typeof b === 'number' && typeof a === 'number') {
      if (key === 'hp' && typeof before[key] === 'number') {
        const step = b - a;
        const accel = Math.max(0, step - (a - (before[key] as number)));
        next[key] = Math.round(b + step + accel);
      } else {
        next[key] = Math.max(0, round(b + (b - a)));
      }
    } else if (typeof b === 'string' && typeof a === 'string') {
      next[key] = nextDice(a, b);
    } else {
      next[key] = b;
    }
  }
  return next;
}

export function extendLevels(levels: StatLine[], target: number): StatLine[] {
  const out = levels.map(line => ({ ...line }));
  while (out.length > 0 && out.length < target) out.push(nextLine(out));
  return out;
}
