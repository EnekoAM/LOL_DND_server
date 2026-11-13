/**
 * Segunda pasada: automatiza las reglas que en la primera pasada quedaron a mano.
 * Fuente de valores: el texto guardado en la ficha del ítem.
 * Barrera frondosa: CD 30 (el valor guardado); el texto «cada 10 turnos» pasa a «cada 30 turnos».
 *   npx tsx scripts/set-item-effects-pass2.ts --dry
 *   npx tsx scripts/set-item-effects-pass2.ts
 * Con escritura: copia JSON de ítems y namedEffectDescriptions ANTES de tocar la base.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig, setNamedEffectDescription, type EffectBonusConfig } from '../src/namedEffectDescriptions';

const dry = process.argv.includes('--dry');

const BONUS: Record<string, EffectBonusConfig> = {
  'bring-it-down': parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'damage', dice: '4d10+13', damageType: 'physical', everyN: 3, perTargetCounter: true, missingHpScalePct: 75, onlyIf: 'melee' },
      { trigger: 'on-hit', kind: 'damage', dice: '4d8+9', damageType: 'physical', everyN: 3, perTargetCounter: true, missingHpScalePct: 75, onlyIf: 'ranged' },
    ],
  }),
  'clawing-shadows': parseEffectBonusConfig({
    cooldown: 7,
    rules: [{ trigger: 'on-hit', kind: 'slow', slowPct: 30, duration: 1, maxStacks: 3, triggerAtMax: true, perTargetCounter: true, cooldownOnProc: true }],
  }),
  wrath: parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'damage', dice: '2d2', damageType: 'magic' }],
  }),
  'seething-strike': parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'attack-speed', flat: 8, duration: 2, maxStacks: 4 },
      { trigger: 'on-hit', kind: 'extra-on-hit', count: 1, everyN: 3, requiresMaxStacks: true },
    ],
  }),
  transcendence: parseEffectBonusConfig({
    rules: [{ trigger: 'on-hit', kind: 'extra-action', action: 'ability', everyN: 7 }],
  }),
  hatefog: parseEffectBonusConfig({
    duration: 2,
    rules: [
      { trigger: 'on-ability-hit', kind: 'damage', appliesTo: 'area', dice: '4d4+2', ratios: [{ stat: 'ap', pct: 7 }], damageType: 'magic', pulseEachTurn: true, duration: 2 },
      { trigger: 'on-ability-hit', kind: 'stat', appliesTo: 'area', stat: 'mr', flat: -1, duration: 2 },
    ],
  }),
  scorn: parseEffectBonusConfig({
    rules: [{ trigger: 'always', kind: 'status', appliesTo: 'self', statusName: 'Malignidad (+20 AH a la R)', note: 'Las habilidades no tienen CD de turno: +20 AH a la R no cambia nada' }],
  }),
  'frostfire-tempest': parseEffectBonusConfig({
    cooldown: 5, duration: 1,
    rules: [{ trigger: 'on-ultimate-use', kind: 'damage', appliesTo: 'nearby', dice: '2d2', damageType: 'magic' }],
  }),
  cryocumbustion: parseEffectBonusConfig({
    rules: [{ trigger: 'on-ultimate-use', kind: 'slow', appliesTo: 'nearby', slowPct: 30, duration: 1 }],
  }),
  unmake: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-hit', kind: 'stat', appliesTo: 'target', stat: 'mr', flat: -1, duration: 1, auraRange: 2 },
      { trigger: 'on-ability-hit', kind: 'stat', appliesTo: 'target', stat: 'mr', flat: -1, duration: 1, auraRange: 2 },
    ],
  }),
  annul: parseEffectBonusConfig({
    rules: [{ trigger: 'each-turn', kind: 'status', appliesTo: 'self', statusName: 'Escudo de hechizos', spellShield: true, duration: 99 }],
  }),
  nightstalker: parseEffectBonusConfig({
    duration: 2,
    rules: [
      { trigger: 'each-turn', kind: 'status', appliesTo: 'self', statusName: 'Invisible', unseenTurns: 1, armedTurnsAfterSeen: 2, duration: 2 },
      { trigger: 'on-hit', kind: 'damage', dice: '2d8', ratios: [{ stat: 'lethality', pct: 100 }], damageType: 'true' },
      { trigger: 'on-damage-taken', kind: 'status', appliesTo: 'self', statusName: 'Visto', armedTurnsAfterSeen: 2, duration: 1 },
    ],
  }),
  cinderbloom: parseEffectBonusConfig({
    rules: [{ trigger: 'on-ability-hit', kind: 'status', statusName: 'Llamasombría (crít. 20%)', targetHpBelowPct: 40, duration: 1, critPotencyPct: 20 }],
  }),
  control: parseEffectBonusConfig({
    rules: [{ trigger: 'on-ability-hit', kind: 'status', statusName: 'Mandato (+7% daño)', duration: 2, damageAmpPct: 7 }],
  }),
  eternity: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-damage-taken', kind: 'mana', fromDamagePct: 10 },
      { trigger: 'on-use', kind: 'heal', fromManaSpentPct: 25 },
    ],
  }),
  intervention: parseEffectBonusConfig({
    cooldown: 45, oncePerCombat: true,
    rules: [
      { trigger: 'on-use', kind: 'heal', appliesTo: 'allies', levelFrom: 'target', perLevel: [30, 30, 30, 30, 30, 41.7, 41.7, 41.7, 41.7, 41.7, 53.5, 53.5, 53.5, 53.5, 53.5, 65.2, 65.2, 65.2, 65.2, 65.2], delayTurns: 1, note: 'Se puede usar derrotado; el área se elige a mano' },
      { trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'targetMaxHp', pct: 10 }], damageType: 'true', delayTurns: 1 },
    ],
  }),
  devotion: parseEffectBonusConfig({
    cooldown: 45, duration: 2, oncePerCombat: true,
    rules: [{ trigger: 'on-use', kind: 'shield', appliesTo: 'allies', levelFrom: 'target', perLevel: [25, 25, 25, 25, 25, 29, 29, 29, 29, 29, 31.1, 31.1, 31.1, 31.1, 31.1, 34.6, 34.6, 34.6, 34.6, 34.6], duration: 2, halfAfterTurns: 1, note: 'Área 2 m a mano (no hay tablero)' }],
  }),
  fanfare: parseEffectBonusConfig({
    rules: [
      { trigger: 'on-ability-hit', kind: 'attack-speed', appliesTo: 'allies', flat: 30, duration: 4, onlyIf: 'melee' },
      { trigger: 'on-ability-hit', kind: 'stat', appliesTo: 'allies', stat: 'spe', flat: 1, duration: 4, onlyIf: 'melee' },
      { trigger: 'on-ability-hit', kind: 'attack-speed', appliesTo: 'allies', flat: 20, duration: 2, onlyIf: 'ranged' },
      { trigger: 'on-ability-hit', kind: 'stat', appliesTo: 'allies', stat: 'spe', flat: 1, duration: 2, onlyIf: 'ranged' },
    ],
  }),
};

const BARRERA = 'Barrera frondosa';

function assertNotes(config: EffectBonusConfig, id: string): void {
  for (const rule of config.rules) {
    if (rule.note && rule.note.length > 120) throw new Error(`${id}: note demasiado larga (${rule.note.length})`);
  }
}

async function main(): Promise<void> {
  for (const [id, config] of Object.entries(BONUS)) assertNotes(config, id);

  const db = await getDb();
  const items = db.collection<{ _id: unknown; nombre?: string; namedEffects?: string[]; efecto?: { pasiva?: string; activa?: string }; cooldown?: number | null }>('items');
  const effects = db.collection<{ _id: string; bonus?: EffectBonusConfig }>('namedEffectDescriptions');

  const report: string[] = [];
  for (const [id, config] of Object.entries(BONUS)) {
    const prev = await effects.findOne({ _id: id });
    report.push(`${id}: ${prev?.bonus ? 'actualiza bonus' : 'nuevo bonus'} (${config.rules.length} regla(s))`);
  }

  const barrera = await items.findOne({ nombre: BARRERA });
  if (!barrera) {
    report.push(`ITEM NO ENCONTRADO: ${BARRERA}`);
  } else {
    const pasiva = barrera.efecto?.pasiva ?? '';
    const activa = barrera.efecto?.activa ?? '';
    const nextPasiva = pasiva.replace(/cada 10 turnos/gi, 'cada 30 turnos');
    const nextActiva = activa.replace(/cada 10 turnos/gi, 'cada 30 turnos');
    report.push(`${BARRERA}: cooldown guardado=${barrera.cooldown ?? '—'} (se mantiene); pasiva «10»→«30»: ${pasiva !== nextPasiva ? 'sí' : 'no hace falta'}; activa: ${activa !== nextActiva ? 'sí' : 'igual'}`);
  }

  if (dry) {
    console.log(report.join('\n'));
    console.log('[dry] nada escrito');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups', `${stamp}-item-effects-pass2`);
  mkdirSync(dir, { recursive: true });
  const allItems = await items.find({}).toArray();
  const allFx = await effects.find({}).toArray();
  writeFileSync(join(dir, 'items.json'), JSON.stringify(allItems, null, 2), 'utf8');
  writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(allFx, null, 2), 'utf8');
  console.log(`Copia previa: ${dir} (${allItems.length} ítems, ${allFx.length} efectos)`);

  for (const [id, config] of Object.entries(BONUS)) {
    await setNamedEffectDescription({ id, bonus: config });
  }
  if (barrera) {
    const pasiva = (barrera.efecto?.pasiva ?? '').replace(/cada 10 turnos/gi, 'cada 30 turnos');
    const activa = (barrera.efecto?.activa ?? '').replace(/cada 10 turnos/gi, 'cada 30 turnos');
    const efecto = { ...(barrera.efecto ?? { pasiva: '', activa: '' }), pasiva, activa };
    await items.updateOne({ nombre: BARRERA }, { $set: { efecto } });
  }
  console.log(report.join('\n'));
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
