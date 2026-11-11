/**
 * Prefill del configurador de bonus de los efectos con nombre (namedEffectDescriptions.bonus).
 * Valores de la wiki de LoL (parche actual) pasados a turnos: 1 turno ≈ 2 s, redondeando hacia arriba, mínimo 1.
 * Antes copia namedEffectDescriptions e items en backups/<fecha>-effect-bonuses/. Solo hace $set de bonus
 * (upsert por _id): nunca toca description ni onHit. Si el id ya tiene bonus, no se pisa (salvo --force).
 *   npx tsx scripts/fill-effect-bonuses.ts [--dry] [--force]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/db';
import { parseEffectBonusConfig, type EffectBonusConfig, type EffectRule } from '../src/namedEffectDescriptions';

type R = EffectRule;
const ON_HIT_AND_ABILITY = (rule: Omit<R, 'trigger'>): R[] => [{ trigger: 'on-hit', ...rule }, { trigger: 'on-ability-hit', ...rule }];
/** 15→80 entre nivel 1 y 18 (Final del ingenio), 19-20 = 80. */
const linear = (from: number, to: number): number[] => Array.from({ length: 20 }, (_, i) => Math.round(from + ((to - from) * Math.min(i, 17)) / 17));

const SPELLBLADE = { cooldown: 1, duration: 5, cdStart: 'on-activate' as const };
const LIFELINE = { cooldown: 45 };

export const BONUSES: Record<string, EffectBonusConfig> = {
  // ── Hoja encantada (10 s de ventana = 5 t.; CD 1,5 s = 1 t., desde que se arma) ──
  'spellblade:ad': { ...SPELLBLADE, rules: [
    { trigger: 'after-ability', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'baseAd', pct: 100 }], note: 'Brillo 100% AD base; Fuerza de trinidad 200% AD base' },
  ] },
  'spellblade:lich': { ...SPELLBLADE, rules: [
    { trigger: 'after-ability', kind: 'damage', damageType: 'magic', ratios: [{ stat: 'baseAd', pct: 75 }, { stat: 'ap', pct: 45 }] },
    { trigger: 'after-ability', kind: 'attack-speed', flat: 50, duration: 1, note: 'solo para ese ataque' },
  ] },
  'spellblade:frost': { ...SPELLBLADE, rules: [
    { trigger: 'after-ability', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'baseAd', pct: 150 }] },
    { trigger: 'after-ability', kind: 'slow', slowPct: 13, duration: 1, note: 'campo de escarcha (2 s)' },
  ] },
  'spellblade:essence': { ...SPELLBLADE, rules: [
    { trigger: 'after-ability', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'baseAd', pct: 100 }, { stat: 'bonusAd', pct: 40 }], note: 'escala con prob. de crítico' },
    { trigger: 'after-ability', kind: 'mana', ratios: [{ stat: 'mana', pct: 3 }], note: 'real: 3% del maná perdido' },
  ] },
  'spellblade:dusk': { ...SPELLBLADE, rules: [
    { trigger: 'after-ability', kind: 'damage', damageType: 'magic', ratios: [{ stat: 'baseAd', pct: 75 }, { stat: 'ap', pct: 10 }] },
    { trigger: 'after-ability', kind: 'heal', ratios: [{ stat: 'ap', pct: 10 }, { stat: 'bonusHp', pct: 3 }] },
    { trigger: 'after-ability', kind: 'extra-on-hit', count: 1 },
  ] },

  // ── Asombro (siempre) ──
  'awe:ap': { rules: [{ trigger: 'always', kind: 'stat', stat: 'ap', ratios: [{ stat: 'bonusMana', pct: 1 }], note: 'Abrazo del serafín: 2% del maná extra' }] },
  'awe:ad': { rules: [{ trigger: 'always', kind: 'stat', stat: 'ad', ratios: [{ stat: 'mana', pct: 2 }] }] },
  'awe:health': { rules: [{ trigger: 'always', kind: 'stat', stat: 'hp', ratios: [{ stat: 'bonusMana', pct: 15 }] }] },

  // ── Debuffs / estados al objetivo ──
  carve: { rules: ON_HIT_AND_ABILITY({ kind: 'stat', appliesTo: 'target', stat: 'ac', ratios: [{ stat: 'targetArmor', pct: -6 }], maxStacks: 5, duration: 3, note: 'Cuchilla negra: −6% armadura por stack con daño físico (6 s)' }) },
  'grievous-wounds': { rules: ON_HIT_AND_ABILITY({ kind: 'status', statusName: 'Heridas graves', duration: 2, note: '−40% curación (3 s)' }) },
  'grievous-wounds:magic': { rules: [{ trigger: 'on-ability-hit', kind: 'status', statusName: 'Heridas graves', duration: 2, note: 'con daño mágico (3 s)' }] },
  unmake: { rules: ON_HIT_AND_ABILITY({ kind: 'stat', appliesTo: 'target', stat: 'mr', flat: -5, ratios: [{ stat: 'bonusHp', pct: -1.2 }], duration: 1, note: 'Máscara abisal: aura a campeones cercanos' }) },
  'winters-caress': { rules: [{ trigger: 'always', kind: 'attack-speed', appliesTo: 'target', flat: -20, note: 'Corazón helado: aura a enemigos cercanos (a mano)' }] },
  rimefrost: { rules: [{ trigger: 'on-ability-hit', kind: 'slow', slowPct: 30, duration: 1, note: 'Rylai: 1 s' }] },
  'bitter-cold': { rules: [{ trigger: 'on-ability-hit', kind: 'slow', slowPct: 30, duration: 1, note: 'Serylda: 1 s' }] },
  'shield-reaver': { rules: ON_HIT_AND_ABILITY({ kind: 'status', statusName: 'Escudos −50%', duration: 2, note: 'Colmillo de serpiente (3 s)' }) },
  torment: { rules: [{ trigger: 'on-ability-hit', kind: 'damage', damageType: 'magic', ratios: [{ stat: 'targetMaxHp', pct: 6 }], note: 'Liandry: quemadura 2% vida máx./s durante 3 s' }] },

  // ── Al impactar ──
  'mists-edge': { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'targetCurrentHp', pct: 9 }], note: 'a distancia: 6%' }] },
  fray: { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', perLevel: linear(15, 80) }] },
  sting: { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', flat: 15 }] },
  'icathian-bite': { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', flat: 15, ratios: [{ stat: 'ap', pct: 20 }] }] },
  wrath: { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', flat: 30 }] },
  'seething-strike': { rules: [{ trigger: 'on-hit', kind: 'attack-speed', flat: 8, maxStacks: 4, duration: 2, note: 'al máximo, cada 3er AA aplica los efectos al impactar 2 veces' }] },
  shadow: { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', flat: 30 }] },
  shock: { rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'mana', pct: 1.5 }], note: 'Muramana, contra campeones' }] },
  'bring-it-down': { cooldown: 1, rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', flat: 150, note: 'Kraken: cada 3er AA (≈1 por turno); +daño según vida perdida del objetivo' }] },
  'colossal-consumption': { cooldown: 15, rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', flat: 70, ratios: [{ stat: 'bonusHp', pct: 6 }], note: 'Corazón de acero: CD 30 s por objetivo; gana vida máx. permanente' }] },
  'ever-rising-moon': { cooldown: 3, rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'targetMaxHp', pct: 6 }], note: 'Eclipse: 2 golpes en 2 s; también da escudo' }] },
  'lightshield-strike': { cooldown: 4, rules: [
    { trigger: 'on-hit', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'baseAd', pct: 75 }], note: 'Cielo partido: el AA es crítico; CD 8 s por objetivo' },
    { trigger: 'on-hit', kind: 'heal', ratios: [{ stat: 'baseAd', pct: 100 }], note: '+6% de la vida perdida' },
  ] },
  'energized:magic': { cooldown: 2, rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'magic', flat: 60, note: 'ataque cargado (100 cargas); Cañón 40, Statikk 60, Rompetormentas 100' }] },
  'energized:physical': { cooldown: 2, rules: [{ trigger: 'on-hit', kind: 'damage', damageType: 'physical', flat: 100, note: 'Ciclovoltaica: ataque cargado; ralentiza 99% a súbditos' }] },

  // ── Siempre ──
  'magical-opus': { rules: [{ trigger: 'always', kind: 'stat', stat: 'ap', ratios: [{ stat: 'ap', pct: 30 }], note: 'Rabadon: +30% AP' }] },
  'void-infusion': { rules: [{ trigger: 'always', kind: 'stat', stat: 'ap', ratios: [{ stat: 'bonusHp', pct: 2 }], note: 'Hacedor de grietas' }] },
  'the-claws-that-catch': { rules: [{ trigger: 'always', kind: 'stat', stat: 'ad', ratios: [{ stat: 'baseAd', pct: 45 }], note: 'Sterak' }] },
  tyranny: { rules: [{ trigger: 'always', kind: 'stat', stat: 'ad', ratios: [{ stat: 'bonusHp', pct: 2 }], note: 'Cota de sangre del señor supremo' }] },

  // ── Al matar / asistir ──
  glory: { rules: [{ trigger: 'on-takedown', kind: 'stat', stat: 'ap', flat: 5, maxStacks: 25, note: 'Mejai: 5 AP por stack (+4 stacks por kill, +2 asistencia; Sello oscuro 4 AP, 10 máx.)' }] },
  defy: { rules: [{ trigger: 'on-takedown', kind: 'heal', ratios: [{ stat: 'bonusAd', pct: 140 }], note: 'Danza de la muerte: limpia el daño retrasado' }] },

  // ── Activas (CD de la wiki: 90 s → 45 t.) ──
  'breaking-shockwave': { cooldown: 8, rules: [
    { trigger: 'on-use', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'ad', pct: 80 }] },
    { trigger: 'on-use', kind: 'slow', slowPct: 35, duration: 2, note: '3 s' },
  ] },
  'heretical-cleave': { cooldown: 5, rules: [{ trigger: 'on-use', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'ad', pct: 80 }], note: 'Hidra profana: +daño a objetivos con poca vida' }] },
  supersonic: { cooldown: 20, rules: [{ trigger: 'on-use', kind: 'damage', damageType: 'magic', flat: 100, ratios: [{ stat: 'ap', pct: 10 }], note: 'Cinturón cohete: CD 40 s' }] },
  'lightning-bolt': { cooldown: 20, rules: [
    { trigger: 'on-use', kind: 'damage', damageType: 'magic', flat: 175, ratios: [{ stat: 'ap', pct: 30 }] },
    { trigger: 'on-use', kind: 'slow', slowPct: 25, duration: 1 },
  ] },
  'time-stop': { cooldown: 60, duration: 2, rules: [{ trigger: 'on-use', kind: 'status', statusName: 'Estasis', duration: 2, note: 'a sí mismo: invulnerable e inmóvil 2,5 s (a mano)' }] },
  quicksilver: { cooldown: 45, rules: [{ trigger: 'on-use', kind: 'status', statusName: 'Limpiar', duration: 1, note: 'a sí mismo: quita control (a mano); Cimitarra: +velocidad' }] },
  humility: { cooldown: 45, rules: [{ trigger: 'on-use', kind: 'slow', slowPct: 55, duration: 1, note: 'Augurio de Randuin: 2 s' }] },

  // ── Manuales (umbral de vida, al recibir daño, cada turno) ──
  'lifeline:shield': { ...LIFELINE, duration: 2, rules: [{ trigger: 'hp-below', hpBelowPct: 30, kind: 'shield', ratios: [{ stat: 'bonusHp', pct: 60 }], note: 'Sterak 60% vida extra; Ángel/Abrazo 200 + 20% AP; Arco escudo 320-530 por nivel' }] },
  'lifeline:magic': { ...LIFELINE, duration: 2, rules: [
    { trigger: 'hp-below', hpBelowPct: 30, kind: 'shield', flat: 200, ratios: [{ stat: 'bonusAd', pct: 150 }], note: 'solo daño mágico; Malmortius (Sorbemaleficios 110-280)' },
    { trigger: 'hp-below', hpBelowPct: 30, kind: 'stat', stat: 'omnivampPct', flat: 10, duration: 2, note: 'Malmortius' },
  ] },
  'lifeline:health': { ...LIFELINE, duration: 4, rules: [{ trigger: 'hp-below', hpBelowPct: 30, kind: 'stat', stat: 'hp', flat: 300, duration: 4, note: 'Arnés de protoplasma: 200-500 por nivel y cura' }] },
  thorns: { rules: [
    { trigger: 'on-attacked', kind: 'damage', damageType: 'magic', flat: 20, ratios: [{ stat: 'bonusArmor', pct: 10 }], note: 'Cota de espinas; Chaleco de zarzas 3 + 10%' },
    { trigger: 'on-attacked', kind: 'status', statusName: 'Heridas graves', duration: 2 },
  ] },
  immolate: { rules: [{ trigger: 'each-turn', kind: 'damage', damageType: 'magic', flat: 20, ratios: [{ stat: 'bonusHp', pct: 1.5 }], note: '≈2 s de quemadura a enemigos cercanos' }] },
  anguish: { cooldown: 4, rules: [{ trigger: 'each-turn', kind: 'damage', damageType: 'magic', flat: 30, ratios: [{ stat: 'bonusHp', pct: 2.5 }], note: 'Desesperación eterna: cada 7 s en combate, cura lo mismo' }] },
};

async function main() {
  const dry = process.argv.includes('--dry');
  const force = process.argv.includes('--force');
  // Validación con el mismo parser que el PATCH de la API.
  const parsed = Object.fromEntries(Object.entries(BONUSES).map(([id, config]) => [id, parseEffectBonusConfig(config)]));
  const db = await getDb();
  const col = db.collection<{ _id: string; bonus?: unknown; description?: string; onHit?: boolean; updatedAt?: string }>('namedEffectDescriptions');
  const items = await db.collection('items').find({}, { projection: { nombre: 1, namedEffects: 1 } }).toArray();
  const existing = await col.find({}).toArray();
  if (!dry) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = join(process.cwd(), 'backups', `${stamp}-effect-bonuses`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'namedEffectDescriptions.json'), JSON.stringify(existing, null, 2), 'utf8');
    writeFileSync(join(dir, 'items.json'), JSON.stringify(items, null, 2), 'utf8');
    console.log(`Copia: ${dir} (${existing.length} docs, ${items.length} ítems)`);
  }
  const usedBy = (id: string) => items
    .filter(item => Array.isArray(item.namedEffects) && (item.namedEffects as string[]).some(e => e === id || (!id.includes(':') && e.split(':')[0] === id)))
    .map(item => String(item.nombre));
  let written = 0;
  for (const [id, bonus] of Object.entries(parsed)) {
    const doc = existing.find(entry => entry._id === id);
    const users = usedBy(id);
    if (doc?.bonus && !force) { console.log(`= ${id}: ya tiene bonus, no se toca`); continue; }
    console.log(`${dry ? '~' : '+'} ${id}: ${bonus.rules.length} regla(s) · ítems: ${users.join(', ') || '(ninguno)'}`);
    if (dry) continue;
    await col.updateOne({ _id: id }, { $set: { bonus, updatedAt: new Date().toISOString() } }, { upsert: true });
    written += 1;
  }
  console.log(`${dry ? 'Simulado' : 'Escritos'}: ${dry ? Object.keys(parsed).length : written}`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
