/** Recursos de campeón y habilidad. Misma lista que web/src/data/resources.ts. */

export const RESOURCE_IDS = [
  'mana',
  'energia',
  'vida',
  'furia',
  'calor',
  'ferocidad',
  'coraje',
  'sangre',
  'escudo',
  'concentracion',
  'ninguno',
  'otro',
] as const;

export type ResourceId = (typeof RESOURCE_IDS)[number];

export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === 'string' && (RESOURCE_IDS as readonly string[]).includes(value);
}
