/**
 * Eneko: las habilidades no tienen CD (se bloquean mientras dura su efecto).
 *  1. Quita los cooldown que puso la wiki (set-champion-abilities) o set-jarvan-w-e: los que no estaban en la copia de antes
 *     de set-champion-abilities (backups/2026-11-12T18-14-01-898Z-champion-abilities/champions.json). Los suyos se quedan
 *     (no se aplican en combate).
 *  2. Jarvan IV: P Cadencia marcial = regla de efecto (8 % de la vida actual del objetivo al AA, físico, CD 3 t. por objetivo);
 *     W Égida dorada = escudo al usarla (60/65/70/75/80 % AD bonus, 2 t., +1.3 % vida máx. por campeón enemigo alcanzado);
 *     E Estandarte demaciano = +20/22/25/27/30 % vel. ataque por tenerla aprendida (sin el buff de la activa: a mano).
 * Copia champions en backups/<fecha>-no-cd-jarvan/ antes.
 *   npx tsx scripts/abilities-no-cd-jarvan.ts --dry   |   npx tsx scripts/abilities-no-cd-jarvan.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

type Doc = { _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> };
const SLOTS = ['P', 'Q', 'W', 'E', 'R'] as const;
const BEFORE = join(process.cwd(), 'backups', '2026-11-12T18-14-01-898Z-champion-abilities', 'champions.json');

async function main() {
  const dry = process.argv.includes('--dry');
  const before = new Map((JSON.parse(readFileSync(BEFORE, 'utf8')) as Doc[]).map(doc => [doc.champion, doc]));
  const db = await getDb();
  const col = db.collection<Doc>('champions');
  const all = await col.find({}).toArray();
  const updates: { id: ObjectId; champion: string; $set: Record<string, unknown>; $unset: Record<string, ''> }[] = [];
  const kept: string[] = [];
  for (const doc of all) {
    const old = before.get(doc.champion);
    const $unset: Record<string, ''> = {};
    const $set: Record<string, unknown> = {};
    for (const slot of SLOTS) {
      const now = doc.abilities?.[slot];
      if (!now) continue;
      const was = old?.abilities?.[slot];
      if (typeof now.cooldown === 'number') {
        if (typeof was?.cooldown === 'number') kept.push(`${doc.champion} ${slot} «${now.name}» CD ${now.cooldown} (suyo)`);
        else $unset[`abilities.${slot}.cooldown`] = '';
      }
      (now.variants ?? []).forEach((variant, index) => {
        if (typeof variant.cooldown !== 'number') return;
        if (typeof was?.variants?.[index]?.cooldown === 'number') kept.push(`${doc.champion} ${slot} fase ${index + 2} CD ${variant.cooldown} (suyo)`);
        else $unset[`abilities.${slot}.variants.${index}.cooldown`] = '';
      });
    }
    if (doc.champion === 'Jarvan IV') {
      const ab = doc.abilities ?? {};
      if (!ab.P || !ab.W || !ab.E) throw new Error('Jarvan IV P/W/E no existe');
      const strip = (a: ChampionAbility): ChampionAbility => { const { cooldown: _cd, ...rest } = a; return rest; };
      const P: ChampionAbility = {
        ...ab.P,
        mechanics: { ...ab.P.mechanics, effectRules: { cooldown: 3, perTargetCooldown: true, rules: [{ trigger: 'on-attack', kind: 'damage', damageType: 'physical', ratios: [{ stat: 'targetCurrentHp', pct: 8 }] }] } },
      };
      const W: ChampionAbility = {
        ...strip(ab.W),
        description: 'Jarvan IV ralentiza a los enemigos cercanos y se protege con un escudo (60/65/70/75/80 % del AD bonus durante 2 t., +1.3 % de su vida máxima por cada campeón enemigo alcanzado).',
        mechanics: { ...ab.W.mechanics, castPool: { kind: 'shield', ratios: [{ stat: 'bonusAd', values: [60, 65, 70, 75, 80] }], turns: 2, perChampionHit: { stat: 'hp', pct: 1.3 } } },
      };
      const { buff: _buff, ...eMech } = ab.E.mechanics ?? {};
      const E: ChampionAbility = {
        ...strip(ab.E),
        description: 'De forma pasiva da una bonificacion de velocidad de ataque (20/22/25/27/30 % por tenerla aprendida). Coloca una bandera que inflige daño y otorga velocidad de ataque a los aliados cercanos (bonus de la activa: a mano).',
        mechanics: { ...eMech, learnedStats: [{ stat: 'atkSpePct', values: [20, 22, 25, 27, 30] }] },
      };
      for (const [slot, ability] of [['P', P], ['W', W], ['E', E]] as const) {
        const parsed = parseChampionAbilityPatch({ slot, ability }).ability;
        $set[`abilities.${slot}`] = parsed;
        delete $unset[`abilities.${slot}.cooldown`];
        console.log(`Jarvan ${slot} después: ${JSON.stringify(parsed)}`);
      }
    }
    if (Object.keys($unset).length || Object.keys($set).length) updates.push({ id: doc._id, champion: doc.champion, $set, $unset });
  }
  for (const u of updates) console.log(`${u.champion}: quita ${Object.keys(u.$unset).map(k => k.replace('abilities.', '')).join(', ') || '—'}${Object.keys(u.$set).length ? ` · pone ${Object.keys(u.$set).join(', ')}` : ''}`);
  console.log(`CD suyos (se quedan, no se aplican): ${kept.join(' | ') || 'ninguno'}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-no-cd-jarvan`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);
  for (const u of updates) {
    const update: Record<string, unknown> = { $set: { ...u.$set, updatedAt: new Date().toISOString() } };
    if (Object.keys(u.$unset).length) update.$unset = u.$unset;
    await col.updateOne({ _id: u.id }, update);
  }
  console.log(`Actualizados: ${updates.length} campeones`);
  process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
