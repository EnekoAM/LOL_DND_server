/**
 * Rellena el configurador de bonus de las ACTIVAS con lo que escribió Eneko (efectos-objetos.md, sección Activas).
 * Sobrescribe el bonus de esos efectos (sus valores mandan). La descripción solo se pone si el efecto aún no tiene una suya.
 * No toca onHit, area ni otros efectos. Antes copia namedEffectDescriptions en backups/<fecha>-actives/.
 *   npx tsx scripts/fill-actives.ts --dry   (enseña qué cambiaría)
 *   npx tsx scripts/fill-actives.ts         (escribe)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig } from '../src/namedEffectDescriptions';

/** Valor por nivel 1-20 a partir de los tramos que dio Eneko (nivel 1 / 6 / 11 / 16). */
const steps = (l1: number, l6: number, l11: number, l16: number): number[] =>
  Array.from({ length: 20 }, (_, i) => (i + 1 >= 16 ? l16 : i + 1 >= 11 ? l11 : i + 1 >= 6 ? l6 : l1));

type Entry = { bonus: Record<string, unknown>; description: string };

const ACTIVES: Record<string, Entry> = {
  quicksilver: {
    description: 'Al usar, limpia cualquier CC, menos levantamientos. Cimitarra mercurial: además +50% de velocidad de movimiento y fantasmal durante 1 t.',
    bonus: {
      cooldown: 45,
      rules: [
        { trigger: 'on-use', kind: 'status', appliesTo: 'self', statusName: 'Limpiar CC (salvo levantamientos)', note: 'quitar el CC a mano; Cimitarra mercurial: +50% vel. mov. y fantasmal 1 t. (a mano)' },
      ],
    },
  },
  'breaking-shockwave': {
    description: 'Al usar: +80% AD total físico y ralentiza un 35% durante 2 t.',
    bonus: {
      cooldown: 8,
      rules: [
        { trigger: 'on-use', kind: 'damage', ratios: [{ stat: 'ad', pct: 80 }], damageType: 'physical' },
        { trigger: 'on-use', kind: 'slow', slowPct: 35, duration: 2 },
      ],
    },
  },
  crescent: {
    description: 'Al usar, hace un 75% de AD en área.',
    bonus: {
      cooldown: 5,
      rules: [{ trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'ad', pct: 75 }], damageType: 'physical' }],
    },
  },
  devotion: {
    description: 'En un área otorga un escudo según el nivel del objetivo (nivel 1: 4 / 6: 6 / 11: 8 / 16: 10) durante 1 t.',
    bonus: {
      cooldown: 45,
      duration: 1,
      rules: [{ trigger: 'on-use', kind: 'shield', appliesTo: 'allies', perLevel: steps(4, 6, 8, 10), levelFrom: 'target', duration: 1 }],
    },
  },
  'time-stop': {
    description: 'Al usar: aplica Estasis a sí mismo (invulnerable) durante 2 t.',
    bonus: {
      cooldown: 60,
      duration: 2,
      rules: [{ trigger: 'on-use', kind: 'status', appliesTo: 'self', statusName: 'Estasis (invulnerable)', duration: 2 }],
    },
  },
  'heretical-cleave': {
    description: 'Al usar: +80% AD total físico.',
    bonus: {
      cooldown: 5,
      rules: [{ trigger: 'on-use', kind: 'damage', ratios: [{ stat: 'ad', pct: 80 }], damageType: 'physical' }],
    },
  },
  humility: {
    description: 'Al usar: ralentiza un 70% durante 1 t.',
    bonus: {
      cooldown: 45,
      rules: [{ trigger: 'on-use', kind: 'slow', slowPct: 70, duration: 1 }],
    },
  },
  'inspiring-speech': {
    description: 'Otorga un 30% de velocidad de movimiento en área durante 2 t.',
    bonus: {
      cooldown: 37,
      duration: 2,
      rules: [{ trigger: 'on-use', kind: 'move-speed', appliesTo: 'allies', ratios: [{ stat: 'targetSpe', pct: 30 }], duration: 2 }],
    },
  },
  intervention: {
    description: 'Cura en área según el nivel del objetivo (nivel 1: 3 / 6: 4,16 / 11: 5,34 / 16: 6,58) e inflige un 10% de la vida máxima del enemigo.',
    bonus: {
      cooldown: 45,
      rules: [
        { trigger: 'on-use', kind: 'heal', appliesTo: 'allies', perLevel: steps(3, 4.16, 5.34, 6.58), levelFrom: 'target' },
        { trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'targetMaxHp', pct: 10 }], damageType: 'true', note: 'tipo de daño no indicado: verdadero (como en LoL)' },
      ],
    },
  },
  'lightning-bolt': {
    description: 'Al usar: 30% AP mágico y ralentiza un 25% durante 1 t.',
    bonus: {
      cooldown: 20,
      rules: [
        { trigger: 'on-use', kind: 'damage', ratios: [{ stat: 'ap', pct: 30 }], damageType: 'magic' },
        { trigger: 'on-use', kind: 'slow', slowPct: 25, duration: 1 },
      ],
    },
  },
  pledge: {
    description: 'Marca a un aliado como «digno».',
    bonus: {
      cooldown: 30,
      rules: [{ trigger: 'on-use', kind: 'status', appliesTo: 'allies', statusName: 'Digno', note: 'duración no indicada; efecto de «digno» a mano' }],
    },
  },
  purify: {
    description: 'Elimina todos los CC (excepto levantamientos, ceguera, desarme, vista cercana y supresiones) en área y cura según el nivel del objetivo (nivel 1: 2 / 6: 2,88 / 11: 3,76 / 16: 4,64).',
    bonus: {
      cooldown: 60,
      rules: [
        { trigger: 'on-use', kind: 'status', appliesTo: 'allies', statusName: 'Limpiar CC', note: 'excepto levantamientos, ceguera, desarme, vista cercana y supresiones (quitar a mano)' },
        { trigger: 'on-use', kind: 'heal', appliesTo: 'allies', perLevel: steps(2, 2.88, 3.76, 4.64), levelFrom: 'target' },
      ],
    },
  },
  'ravenous-crescent': {
    description: 'Inflige un 80% de tu AD en un área y aplica robo de vida con un 100% de eficacia (usa el robo de vida del usuario: 100 de daño con un 15% de robo de vida cura 15).',
    bonus: {
      rules: [{ trigger: 'on-use', kind: 'damage', appliesTo: 'area', ratios: [{ stat: 'ad', pct: 80 }], damageType: 'physical', lifeSteal: true }],
    },
  },
  supersonic: {
    description: 'Al usar, inflige daño a hasta 7 objetivos: 15% AP.',
    bonus: {
      cooldown: 25,
      maxTargets: 7,
      rules: [{ trigger: 'on-use', kind: 'damage', ratios: [{ stat: 'ap', pct: 15 }], damageType: 'magic' }],
    },
  },
  'titanic-crescent': {
    description: 'Al usar: tu siguiente efecto de impacto estará potenciado: inflige (cuerpo a cuerpo 4% / a distancia 2%) de la vida máxima del objetivo principal y hace daño en área que inflige (cuerpo a cuerpo 9% / a distancia 4,5%) de la vida máxima de los objetivos secundarios. El enfriamiento empieza al hacer el auto-ataque potenciado.',
    bonus: {
      cooldown: 5,
      duration: 5,
      cdStart: 'on-end',
      rules: [
        { trigger: 'after-use', kind: 'damage', onlyIf: 'melee', ratios: [{ stat: 'targetMaxHp', pct: 4 }], damageType: 'physical' },
        { trigger: 'after-use', kind: 'damage', onlyIf: 'ranged', ratios: [{ stat: 'targetMaxHp', pct: 2 }], damageType: 'physical' },
        { trigger: 'after-use', kind: 'damage', appliesTo: 'nearby', onlyIf: 'melee', ratios: [{ stat: 'targetMaxHp', pct: 9 }], damageType: 'physical' },
        { trigger: 'after-use', kind: 'damage', appliesTo: 'nearby', onlyIf: 'ranged', ratios: [{ stat: 'targetMaxHp', pct: 4.5 }], damageType: 'physical' },
      ],
    },
  },
  'wraith-step': {
    description: 'Obtén (cuerpo a cuerpo 20% / a distancia 15%) de velocidad de movimiento durante (cuerpo a cuerpo 3 t. / a distancia 2 t.).',
    bonus: {
      cooldown: 37,
      rules: [
        { trigger: 'on-use', kind: 'move-speed', onlyIf: 'melee', ratios: [{ stat: 'spe', pct: 20 }], duration: 3 },
        { trigger: 'on-use', kind: 'move-speed', onlyIf: 'ranged', ratios: [{ stat: 'spe', pct: 15 }], duration: 2 },
      ],
    },
  },
};

type Doc = { _id: string; description?: string; bonus?: unknown; updatedAt?: string };

async function main() {
  const dry = process.argv.includes('--dry');
  // Valida todo con el mismo parser que la API antes de tocar nada.
  const parsed = Object.entries(ACTIVES).map(([id, entry]) => ({ id, entry, bonus: parseEffectBonusConfig(entry.bonus) }));
  const db = await getDb();
  const col = db.collection<Doc>('namedEffectDescriptions');
  if (!dry) {
    const all = await col.find({}).toArray();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(process.cwd(), 'backups', `${stamp}-actives`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(all, null, 2), 'utf8');
    console.log(`Copia: ${dir} (${all.length} docs)`);
  }
  const updatedAt = new Date().toISOString();
  for (const { id, entry, bonus } of parsed) {
    const doc = await col.findOne({ _id: id });
    const setDescription = !doc?.description?.trim();
    console.log(`${dry ? '[dry] ' : ''}${id}: bonus ${doc?.bonus ? 'sobrescrito' : 'nuevo'} → ${JSON.stringify(bonus)}${setDescription ? ' · descripción nueva' : ' · descripción suya: no se toca'}`);
    if (dry) continue;
    await col.updateOne({ _id: id }, { $set: { bonus, ...(setDescription ? { description: entry.description } : {}), updatedAt } }, { upsert: true });
  }
  console.log(`${dry ? '[dry] ' : ''}${parsed.length} efectos`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
