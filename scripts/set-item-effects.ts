/**
 * Configura las reglas de combate de los ítems de la lista de Eneko.
 * Fuente de valores: el texto guardado en la ficha del ítem.
 *   npx tsx scripts/set-item-effects.ts --dry
 *   npx tsx scripts/set-item-effects.ts
 * Con escritura: copia JSON de ítems y namedEffectDescriptions ANTES de tocar la base.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig, setNamedEffectDescription, type EffectBonusConfig } from '../src/namedEffectDescriptions';

const dry = process.argv.includes('--dry');

const BONUS: Record<string, EffectBonusConfig> = {
  'spellblade:trinity': parseEffectBonusConfig({
    cooldown: 1, duration: 5, cdStart: 'on-activate',
    rules: [{ trigger: 'after-ability', kind: 'damage', ratios: [{ stat: 'baseAd', pct: 200 }], damageType: 'physical' }],
  }),
  quicken: parseEffectBonusConfig({
    rules: [{ trigger: 'on-attack', kind: 'stat', stat: 'spe', flat: 1, duration: 1 }],
  }),
  'icathian-bite': parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'damage', flat: 1, ratios: [{ stat: 'ap', pct: 15 }], damageType: 'magic' }],
  }),
  'spellblade:dusk': parseEffectBonusConfig({
    cooldown: 1, duration: 5, cdStart: 'on-activate',
    rules: [
      { trigger: 'after-ability', kind: 'damage', ratios: [{ stat: 'baseAd', pct: 75 }, { stat: 'ap', pct: 10 }], damageType: 'magic' },
      { trigger: 'after-ability', kind: 'heal', ratios: [{ stat: 'ap', pct: 10 }, { stat: 'bonusHp', pct: 3 }] },
      { trigger: 'after-ability', kind: 'extra-on-hit', count: 1 },
    ],
  }),
  devotion: parseEffectBonusConfig({
    cooldown: 45, duration: 2, oncePerCombat: true,
    rules: [{ trigger: 'on-use', kind: 'shield', appliesTo: 'allies', levelFrom: 'target', perLevel: [25, 25, 25, 25, 25, 29, 29, 29, 29, 29, 31.1, 31.1, 31.1, 31.1, 31.1, 34.6, 34.6, 34.6, 34.6, 34.6], duration: 2, note: 'A mano: área 2 m; al pasar 1 t. el escudo baja a la mitad' }],
  }),
  intervention: parseEffectBonusConfig({
    cooldown: 45, oncePerCombat: true,
    rules: [
      { trigger: 'on-use', kind: 'heal', appliesTo: 'allies', levelFrom: 'target', perLevel: [30, 30, 30, 30, 30, 41.7, 41.7, 41.7, 41.7, 41.7, 53.5, 53.5, 53.5, 53.5, 53.5, 65.2, 65.2, 65.2, 65.2, 65.2], note: 'A mano: el área tarda 1 t. en caer; se puede usar muerto' },
      { trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'targetMaxHp', pct: 10 }], damageType: 'true' },
    ],
  }),
  'the-claws-that-catch': parseEffectBonusConfig({
    rules: [{ trigger: 'always', kind: 'stat', stat: 'ad', ratios: [{ stat: 'baseAd', pct: 50 }] }],
  }),
  'lifeline:shield': parseEffectBonusConfig({
    cooldown: 45, duration: 2, oncePerCombat: true,
    rules: [{ trigger: 'hp-below', kind: 'shield', ratios: [{ stat: 'bonusHp', pct: 60 }], hpBelowPct: 30, note: 'Sterak 60% vida extra. Ángel/Arcoescudo: a mano si no coinciden' }],
  }),
  firmament: parseEffectBonusConfig({
    rules: [
      { trigger: 'energized-max', kind: 'stat', stat: 'lethality', flat: 0.3, duration: 2, maxStacks: 1, onlyIf: 'melee' },
      { trigger: 'energized-max', kind: 'stat', stat: 'lethality', flat: 0.25, duration: 2, maxStacks: 1, onlyIf: 'ranged' },
      { trigger: 'energized-max', kind: 'damage', ratios: [{ stat: 'targetMaxHp', pct: 9 }], damageType: 'physical', onlyIf: 'melee' },
      { trigger: 'energized-max', kind: 'damage', ratios: [{ stat: 'targetMaxHp', pct: 7 }], damageType: 'physical', onlyIf: 'ranged' },
    ],
  }),
  shock: parseEffectBonusConfig({
    perTargetCooldown: true, cooldown: 2,
    rules: [
      { trigger: 'on-hit', kind: 'damage', ratios: [{ stat: 'mana', pct: 1.2 }], damageType: 'physical' },
      { trigger: 'on-ability-hit', kind: 'damage', ratios: [{ stat: 'mana', pct: 4 }], damageType: 'physical', onlyIf: 'melee' },
      { trigger: 'on-ability-hit', kind: 'damage', ratios: [{ stat: 'mana', pct: 3 }], damageType: 'physical', onlyIf: 'ranged' },
    ],
  }),
  'mists-edge': parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'damage', ratios: [{ stat: 'targetCurrentHp', pct: 9 }], damageType: 'physical', onlyIf: 'melee' },
      { trigger: 'on-hit', kind: 'damage', ratios: [{ stat: 'targetCurrentHp', pct: 6 }], damageType: 'physical', onlyIf: 'ranged' },
    ],
  }),
  'clawing-shadows': parseEffectBonusConfig({
    cooldown: 7,
    rules: [{ trigger: 'on-hit', kind: 'status', statusName: 'Garra (carga BotRK)', maxStacks: 3, note: 'A mano: al llegar a 3 cargas, 30% de ralentización 1 t.; luego CD 7 t.' }],
  }),
  anguish: parseEffectBonusConfig({
    cooldown: 2,
    rules: [{ trigger: 'each-turn', kind: 'damage', ratios: [{ stat: 'bonusHp', pct: 3 }], damageType: 'magic', healFromDealtPct: 250, note: 'Elige un enemigo al empezar el turno' }],
  }),
  carve: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'stat', appliesTo: 'target', stat: 'ac', ratios: [{ stat: 'targetArmor', pct: -6 }], duration: 3, maxStacks: 5 },
      { trigger: 'on-ability-hit', kind: 'stat', appliesTo: 'target', stat: 'ac', ratios: [{ stat: 'targetArmor', pct: -6 }], duration: 3, maxStacks: 5 },
    ],
  }),
  fervor: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'stat', stat: 'spe', flat: 1, duration: 1 },
      { trigger: 'on-ability-hit', kind: 'stat', stat: 'spe', flat: 1, duration: 1 },
    ],
  }),
  'cleave:ad': parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'damage', appliesTo: 'nearby', ratios: [{ stat: 'ad', pct: 40 }], damageType: 'physical', onlyIf: 'melee' },
      { trigger: 'on-hit', kind: 'damage', appliesTo: 'nearby', ratios: [{ stat: 'ad', pct: 20 }], damageType: 'physical', onlyIf: 'ranged' },
    ],
  }),
  crescent: parseEffectBonusConfig({
    cooldown: 5,
    rules: [{ trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'ad', pct: 75 }], damageType: 'physical' }],
  }),
  'time-stop': parseEffectBonusConfig({
    cooldown: 60, duration: 2, oncePerCombat: true,
    rules: [{ trigger: 'on-use', kind: 'status', appliesTo: 'self', statusName: 'Estasis (invulnerable)', duration: 2 }],
  }),
  plating: parseEffectBonusConfig({
    rules: [{ trigger: 'on-attacked', kind: 'damage-reduction', flat: 10, vs: 'aa' }],
  }),
  cinderbloom: parseEffectBonusConfig({
    rules: [{ trigger: 'on-ability-hit', kind: 'status', statusName: 'Llamasombría (crít. 20%)', targetHpBelowPct: 40, note: 'Daño mágico o verdadero: puede criticar al 20% (dados a mano)' }],
  }),
  command: parseEffectBonusConfig({
    rules: [{ trigger: 'each-turn', kind: 'mana', flat: 5 }],
  }),
  control: parseEffectBonusConfig({
    rules: [{ trigger: 'on-ability-hit', kind: 'status', statusName: 'Mandato (+7% daño)', duration: 2, note: 'A mano: +7% daño si está inmovilizado; +20 AH solo en habilidades con CC' }],
  }),
  fanfare: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-ability-hit', kind: 'attack-speed', appliesTo: 'allies', flat: 30, duration: 4, onlyIf: 'melee', note: 'A mano: área 5 m y +1 SPE; 4 t. cuerpo a cuerpo / 2 t. a distancia' },
      { trigger: 'on-ability-hit', kind: 'attack-speed', appliesTo: 'allies', flat: 20, duration: 2, onlyIf: 'ranged', note: 'A mano: el área de 5 m y el +1 SPE' },
    ],
  }),
  death: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'execute', targetHpBelowPct: 5 },
      { trigger: 'on-ability-hit', kind: 'execute', targetHpBelowPct: 5 },
    ],
  }),
  taxes: parseEffectBonusConfig({
    rules: [{ trigger: 'on-takedown', kind: 'status', appliesTo: 'self', statusName: 'Impuestos (+25 oro)', note: 'A mano: +25 de oro si el derribo es un campeón' }],
  }),
  slay: parseEffectBonusConfig({
    rules: [{ trigger: 'on-takedown', kind: 'stat', stat: 'omnivampPct', flat: 0.6, maxStacks: 10, permanent: true, note: 'Solo al eliminar a un campeón; tope 6% (10 × 0,6)' }],
  }),
  'starlit-grace': parseEffectBonusConfig({
    rules: [
      { trigger: 'each-turn', kind: 'mana', flat: 4 },
      { trigger: 'on-use', kind: 'status', appliesTo: 'self', statusName: 'Gracia estelar', note: 'A mano: al curar/escudar a un aliado, se transmite a otro (30% cura / 35% escudo)' },
    ],
  }),
  transcendence: parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'extra-action', action: 'ability', note: 'A mano: 7 cargas de AA; al máximo se reinician y puedes echar una habilidad básica más' }],
  }),
  'seething-strike': parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'attack-speed', flat: 8, duration: 2, maxStacks: 4, note: 'A mano: al máximo, cada 3er AA aplica los efectos de impacto otra vez' }],
  }),
  wrath: parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', note: '2d2 de daño mágico (tirar a mano)' }],
  }),
  'bring-it-down': parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', note: 'A mano: cada 3er impacto (máx. 3): melee 4d10+13 / ranged 4d8+9, hasta +75% vida faltante' }],
  }),
  annul: parseEffectBonusConfig({
    cooldown: 10,
    rules: [{ trigger: 'always', kind: 'status', appliesTo: 'self', statusName: 'Escudo de hechizos', note: 'A mano: bloquea la siguiente habilidad enemiga; CD 10 t. al romperse' }],
  }),
  eternity: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-damage-taken', kind: 'mana', fromDamagePct: 10 },
      { trigger: 'on-use', kind: 'status', appliesTo: 'self', statusName: 'Eternidad (maná gastado)', note: 'A mano: te curas un 25% del maná gastado' },
    ],
  }),
  timeless: parseEffectBonusConfig({
    rules: [{ trigger: 'on-takedown', kind: 'status', appliesTo: 'self', statusName: 'Eternidad (entre combates)', note: 'A mano: 1 carga por combate ganado vs campeones (máx. 10)' }],
  }),
  unmake: parseEffectBonusConfig({
    rules: [{ trigger: 'always', kind: 'status', statusName: 'Máscara abisal (−1 RM a 2 m)', note: 'A mano: aura −1 RM a enemigos a 2 m' }],
  }),
  hatefog: parseEffectBonusConfig({
    duration: 2,
    rules: [{ trigger: 'on-ability-hit', kind: 'damage', damageType: 'magic', note: 'A mano: área 2 m / 2 t.: 4d4+2 + 7% AP cada turno y −1 RM. +20 AH solo a la R' }],
  }),
  scorn: parseEffectBonusConfig({
    rules: [{ trigger: 'always', kind: 'status', appliesTo: 'self', statusName: 'Malignidad (+20 AH a la R)', note: 'A mano: +20 de velocidad de habilidades solo para la R' }],
  }),
  'frostfire-tempest': parseEffectBonusConfig({
    cooldown: 5, duration: 1,
    rules: [{ trigger: 'on-use', kind: 'damage', appliesTo: 'nearby', damageType: 'magic', note: 'A mano: al lanzar la R, tormenta 1 m / 1 t.: 2d2 mágico y 30% ralentización' }],
  }),
  cryocumbustion: parseEffectBonusConfig({
    rules: [{ trigger: 'on-use', kind: 'slow', appliesTo: 'nearby', slowPct: 30, duration: 1, note: 'Va con la tormenta de la R (Frostfire); a mano el área' }],
  }),
  nightstalker: parseEffectBonusConfig({
    duration: 2,
    rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'true', note: 'A mano: tras 1 t. invisible, el AA hace 2d8 + letalidad verdadero (dura 2 t. al ser visto)' }],
  }),
  blackout: parseEffectBonusConfig({
    oncePerCombat: true,
    rules: [{ trigger: 'on-use', kind: 'status', statusName: 'Apagón (revela trampa)', note: 'A mano: revela una trampa enemiga a 2 m durante 4 t.; 1 vez por combate' }],
  }),
};

const ITEM_NAMED: Record<string, string[]> = {
  'Fuerza de trinidad': ['spellblade:trinity', 'quicken'],
};

function assertNotes(config: EffectBonusConfig, id: string): void {
  for (const rule of config.rules) {
    if (rule.note && rule.note.length > 120) throw new Error(`${id} note ${rule.note.length}: ${rule.note}`);
    if (rule.statusName && rule.statusName.length > 40) throw new Error(`${id} statusName ${rule.statusName.length}: ${rule.statusName}`);
  }
}

async function main() {
  for (const [id, config] of Object.entries(BONUS)) assertNotes(config, id);
  const db = await getDb();
  const items = db.collection<{ _id: unknown; nombre?: string; namedEffects?: string[] }>('items');
  const effects = db.collection<{ _id: string; bonus?: EffectBonusConfig }>('namedEffectDescriptions');

  const report: string[] = [];
  for (const [id, config] of Object.entries(BONUS)) {
    const prev = await effects.findOne({ _id: id });
    report.push(`${id}: ${prev?.bonus ? 'actualiza bonus' : 'nuevo bonus'} (${config.rules.length} regla(s))`);
  }
  for (const [nombre, namedEffects] of Object.entries(ITEM_NAMED)) {
    const doc = await items.findOne({ nombre });
    if (!doc) { report.push(`ITEM NO ENCONTRADO: ${nombre}`); continue; }
    report.push(`${nombre}: namedEffects ${JSON.stringify(doc.namedEffects ?? [])} → ${JSON.stringify(namedEffects)}`);
  }

  if (dry) {
    console.log(report.join('\n'));
    console.log('[dry] nada escrito');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `${stamp}-item-effects`);
  mkdirSync(dir, { recursive: true });
  const allItems = await items.find({}).toArray();
  const allFx = await effects.find({}).toArray();
  writeFileSync(join(dir, 'items.json'), JSON.stringify(allItems, null, 2), 'utf8');
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(allFx, null, 2), 'utf8');
  console.log(`Copia previa: ${dir} (${allItems.length} ítems, ${allFx.length} efectos)`);

  for (const [id, config] of Object.entries(BONUS)) {
    await setNamedEffectDescription({ id, bonus: config });
  }
  for (const [nombre, namedEffects] of Object.entries(ITEM_NAMED)) {
    const doc = await items.findOne({ nombre });
    if (!doc) continue;
    await items.updateOne({ nombre }, { $set: { namedEffects } });
  }
  console.log(report.join('\n'));
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
