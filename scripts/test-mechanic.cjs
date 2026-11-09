/**
 * Tests de mecánicas de personaje (sin tocar Mongo).
 * Uso: node scripts/test-mechanic.cjs
 */
'use strict';

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const FAMA_REGIONS = [
  'Demacia', 'Noxus', 'Freljord', 'Jonia', 'Piltover', 'Zaun',
  'Shurima', 'Targon', 'Bilgewater', 'Islas de la Sombra', 'Ixtal', 'Bandle',
];

function famaRankTitle(score) {
  if (score >= 1001) return 'Entidad Inmortalizada';
  if (score >= 501) return 'Mito Viviente';
  if (score >= 251) return 'Ícono Nacional';
  if (score >= 101) return 'Leyenda Regional';
  if (score >= 51) return 'Héroe de la Región';
  if (score >= 26) return 'Fama Local';
  if (score >= 11) return 'Reconocido';
  if (score >= 1) return 'Nombre Ocasional';
  if (score === 0) return 'Desconocido';
  if (score >= -10) return 'Sospechoso';
  if (score >= -25) return 'Temido';
  if (score >= -50) return 'Peligro Público';
  if (score >= -100) return 'Enemigo del Pueblo';
  if (score >= -250) return 'Abominación Local';
  if (score >= -500) return 'Miedo Nacional';
  if (score >= -1000) return 'Mito del Terror';
  return 'Entidad Maldita';
}

const HUMANIDAD_POSITIVE = [2, 4, 6, 8, 10].map(level => ({ level, text: String(level) }));
const HUMANIDAD_NEGATIVE = [-2, -4, -6, -8, -10].map(level => ({ level, text: String(level) }));

function humanidadActiveTiers(value) {
  if (value > 0) return HUMANIDAD_POSITIVE.filter(t => t.level <= value);
  if (value < 0) return HUMANIDAD_NEGATIVE.filter(t => t.level >= value).sort((a, b) => b.level - a.level);
  return [];
}

function resolveRuinaControl(contador, rng) {
  const level = Math.min(20, Math.max(1, Math.trunc(contador)));
  const d20 = 1 + Math.floor(rng() * 20);
  if (d20 > level) return { kind: 'control', d20, contador: level };
  const effectRoll = 1 + Math.floor(rng() * 4);
  return { kind: 'lose', d20, contador: level, effectRoll };
}

assert(famaRankTitle(0) === 'Desconocido', 'fama 0');
assert(famaRankTitle(1) === 'Nombre Ocasional', 'fama 1');
assert(famaRankTitle(10) === 'Nombre Ocasional', 'fama 10');
assert(famaRankTitle(11) === 'Reconocido', 'fama 11');
assert(famaRankTitle(26) === 'Fama Local', 'fama 26');
assert(famaRankTitle(51) === 'Héroe de la Región', 'fama 51');
assert(famaRankTitle(101) === 'Leyenda Regional', 'fama 101');
assert(famaRankTitle(251) === 'Ícono Nacional', 'fama 251');
assert(famaRankTitle(501) === 'Mito Viviente', 'fama 501');
assert(famaRankTitle(1001) === 'Entidad Inmortalizada', 'fama 1001');
assert(famaRankTitle(-1) === 'Sospechoso', 'infamia -1');
assert(famaRankTitle(-11) === 'Temido', 'infamia -11');
assert(famaRankTitle(-26) === 'Peligro Público', 'infamia -26');
assert(famaRankTitle(-51) === 'Enemigo del Pueblo', 'infamia -51');
assert(famaRankTitle(-101) === 'Abominación Local', 'infamia -101');
assert(famaRankTitle(-251) === 'Miedo Nacional', 'infamia -251');
assert(famaRankTitle(-501) === 'Mito del Terror', 'infamia -501');
assert(famaRankTitle(-1001) === 'Entidad Maldita', 'infamia -1001');

assert(humanidadActiveTiers(0).length === 0, 'hum 0');
assert(humanidadActiveTiers(3).map(t => t.level).join(',') === '2', 'hum 3');
assert(humanidadActiveTiers(10).map(t => t.level).join(',') === '2,4,6,8,10', 'hum 10');
assert(humanidadActiveTiers(-5).map(t => t.level).join(',') === '-2,-4', 'hum -5');
assert(humanidadActiveTiers(-10).map(t => t.level).join(',') === '-2,-4,-6,-8,-10', 'hum -10');

{
  let i = 0;
  const r = resolveRuinaControl(5, () => [0, 0][i++] ?? 0);
  assert(r.kind === 'lose' && r.d20 === 1 && r.effectRoll === 1, 'ruina lose');
}
{
  let i = 0;
  const r = resolveRuinaControl(5, () => [0.99][i++] ?? 0);
  assert(r.kind === 'control' && r.d20 === 20, 'ruina control');
}
{
  let i = 0;
  const r = resolveRuinaControl(5, () => [(5 - 1) / 20, 0.5][i++] ?? 0);
  assert(r.kind === 'lose' && r.d20 === 5 && r.effectRoll === 3, 'ruina equal loses');
}

assert(FAMA_REGIONS.length === 12, '12 regions');
console.log('logic ok');

const { spawnSync } = require('child_process');
const path = require('path');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', path.join(__dirname, 'test-mechanic-validate.ts')],
  { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: process.env, shell: true },
);
if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.status || 1);
}
process.stdout.write(result.stdout);
console.log('ALL OK');
