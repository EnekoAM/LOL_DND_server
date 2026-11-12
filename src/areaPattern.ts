import { HttpError } from './errors';

/**
 * Patrón de área (tablero) de un efecto o habilidad: cuadrícula size×size (impar), la casilla del usuario,
 * la del objetivo y las casillas donde hace efecto. Coordenadas [x, y] desde 0 (arriba a la izquierda).
 */
export type AreaPattern = { size: number; user: [number, number] | null; target: [number, number] | null; tiles: [number, number][] };

export const AREA_MIN_SIZE = 5;
export const AREA_MAX_SIZE = 21;

function cell(value: unknown, size: number, field: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new HttpError(400, `${field} tiene que ser [x, y]`);
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
    throw new HttpError(400, `${field} tiene que estar dentro del tablero (0-${size - 1})`);
  }
  return [x, y];
}

/** null / undefined → undefined (sin área). Valida tamaño impar 5-21, coordenadas dentro y casillas sin repetir. */
export function parseAreaPattern(value: unknown, field = 'area'): AreaPattern | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, `${field} tiene que ser un objeto`);
  const source = value as Record<string, unknown>;
  const size = source.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < AREA_MIN_SIZE || size > AREA_MAX_SIZE || size % 2 === 0) {
    throw new HttpError(400, `${field}.size tiene que ser un impar entre ${AREA_MIN_SIZE} y ${AREA_MAX_SIZE}`);
  }
  const user = source.user === undefined || source.user === null ? null : cell(source.user, size, `${field}.user`);
  const target = source.target === undefined || source.target === null ? null : cell(source.target, size, `${field}.target`);
  if (source.tiles !== undefined && source.tiles !== null && !Array.isArray(source.tiles)) throw new HttpError(400, `${field}.tiles tiene que ser una lista`);
  const raw = Array.isArray(source.tiles) ? source.tiles : [];
  if (raw.length > size * size) throw new HttpError(400, `${field}.tiles: como máximo ${size * size} casillas`);
  const seen = new Set<string>();
  const tiles: [number, number][] = [];
  raw.forEach((entry, index) => {
    const [x, y] = cell(entry, size, `${field}.tiles[${index}]`);
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push([x, y]);
  });
  if (!user && !target && tiles.length === 0) return undefined;
  return { size, user, target, tiles };
}
