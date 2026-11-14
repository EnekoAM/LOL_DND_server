/**
 * Arreglos 1–11 de Samael / Combatiente / Zerav (sin tocar Zerav R ni el bonus
 * aliado de Combatiente E). Números que faltaban: wiki + reglas de Eneko.
 *   npx tsx scripts/set-players-fix.ts --dry   |   npx tsx scripts/set-players-fix.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility } from '../src/validate';

type Loose = Record<string, unknown>;

type Patch = {
  champion: string;
  slot: 'P' | 'Q' | 'W' | 'E' | 'R';
  name: string;
  description: string;
  fields?: Loose;
};

const PATCHES: Patch[] = [
  {
    champion: 'Hwei',
    slot: 'P',
    name: 'Firma del visionario',
    description:
      'Pasiva (automática). Las habilidades de daño marcan a los enemigos 2 t. (4 s ÷ 2; automático). Dañarlos con otra habilidad distinta consume la marca y provoca una explosión de daño mágico 30/35/40/45 % AP (35 % en el tramo 6, como el 35 % de la wiki; la P innata no usa ±0,05; sin base plana 40–285; automático al marcado). El área (9 casillas / ~285 u.) de la explosión a otros enemigos, a mano. La habilidad que detona no vuelve a marcar en el mismo uso.',
    fields: {
      mechanics: {
        noAction: true,
        mark: { turns: 2, detonateOn: 'ability', damageOnDetonate: true, applyOnAbilityHit: true, name: 'Firma del visionario' },
      },
    },
  },
  {
    champion: 'Karthus',
    slot: 'Q',
    name: 'Sembrar la destrucción',
    description:
      'Explosión de daño mágico 25/30/35/40/45 % AP (automático). Si el objetivo está aislado (interruptor «Objetivo aislado», a juicio de mesa), el daño se duplica (×2; automático). El área, a mano quién es alcanzado.',
    fields: {
      mechanics: { isolated: { multiplier: 2 } },
    },
  },
  {
    champion: 'Aurora',
    slot: 'W',
    name: 'A traves del velo',
    description:
      'Se adentra en el reino espiritual: Invisibilidad 1 t. (automático) y +20/25/30/35/40 % de SPE 2 t. (automático; el estado de 2 t. bloquea volver a usarla). Coste 40 de maná.',
    fields: {
      mechanics: {
        selfStatuses: [
          { name: 'Invisibilidad', turns: 1, blocksAbility: false },
          { name: 'Velocidad de movimiento', turns: 2, stat: 'spe', pctValues: [20, 25, 30, 35, 40], blocksAbility: true },
        ],
      },
    },
  },
  {
    champion: 'Fiddlesticks',
    slot: 'E',
    name: 'Segar',
    description:
      'Área: daño mágico 40/45/50/55/60 % AP (automático) y Ralentización 20/25/30/35/40 % 1 t. a los alcanzados (automático). Silencio 1 t. solo a quienes están en el centro (se eligen a mano tras usarla). El área, a mano quién es alcanzado.',
    fields: {
      mechanics: { centerEffect: { name: 'Silencio', duration: 1 } },
    },
  },
  {
    champion: 'Xin Zhao',
    slot: 'P',
    name: 'Determinacion',
    description:
      'Pasiva (automática). Cada AA da 1 carga (máx. 3; 3 t., se refresca). Al llegar a 3, las gasta, inflige el daño de esta pasiva al objetivo del AA (15/30/45/60 % AD + 5/10/15/20 % AP, tramos 1/6/11/16; ya configurado, la P innata no usa ±0,05; automático) y cura 2/3,5/5/5 % de vida máx. + 40/50/70/70 % AP (wiki Determination: 2/3,5/5 % vida máx. + 40/50/70 % AP en 3 tramos de campeón; el 4.º tramo 16 repite el último; los % de vida y la P innata no usan ±0,05; automático).',
    fields: {
      mechanics: {
        noAction: true,
        stacks: {
          turns: 3,
          max: 3,
          onAa: true,
          consumeAtMax: true,
          onMaxDamage: true,
          onMaxHeal: {
            selfRatios: [
              { stat: 'hp', values: [2, 3.5, 5, 5] },
              { stat: 'ap', values: [40, 50, 70, 70] },
            ],
          },
        },
      },
    },
  },
  {
    champion: 'Xin Zhao',
    slot: 'Q',
    name: 'Golpe de tres garras',
    description:
      'Al usarla (15 de maná) arma los 3 siguientes AA 3 t. (automático; no aplica el daño al lanzarla). Cada AA armado inflige 35/40/45/50/55 % AD bonus (automático). El tercero aplica Levantamiento 1 t. (automático). Mientras dura el efecto (3 t.) no se puede volver a usar.',
    fields: {
      mechanics: {
        armedAa: {
          ad: [0.35, 0.4, 0.45, 0.5, 0.55],
          adSource: 'bonus',
          charges: 3,
          turns: 3,
          effectName: 'Levantamiento',
          effectDuration: 1,
        },
      },
    },
  },
  {
    champion: 'Vi',
    slot: 'W',
    name: 'Abolladuras',
    description:
      'Pasiva (automática, no se gasta al pulsarla). Cada AA da 1 carga al objetivo (máx. 3; 4 t., se refresca, un contador por enemigo). Al llegar a 3, las gasta: daño físico 4/5/6/7/8 % de la vida máx. del objetivo (+3,5 % por cada 100 de AD bonus; wiki Denting Blows; los % de vida no usan ±0,05; automático), −20 % CA 2 t. (4 s ÷ 2; automático) y +30/35/40/45/50 % de velocidad de ataque 2 t. (automático).',
    fields: {
      damage: {
        type: 'fisico',
        hp: [0.04, 0.05, 0.06, 0.07, 0.08],
        hpSource: 'max',
        hpFrom: 'target',
        hpAdPer100: 3.5,
        hpAdSource: 'bonus',
      },
      mechanics: {
        noAction: true,
        stacks: {
          turns: 4,
          max: 3,
          onAa: true,
          countersPerTarget: true,
          consumeAtMax: true,
          onMaxDamage: true,
          onMaxSelfStats: [{ stat: 'atkSpePct', values: [30, 35, 40, 45, 50], turns: 2 }],
        },
        resistShred: { pct: [20], turns: 2, armor: true, mr: false },
      },
    },
  },
  {
    champion: 'Nocturne',
    slot: 'P',
    name: 'Espadas oscuras',
    description:
      'Pasiva (automática). Cada 6 t. (CD estático 12 s ÷ 2; ya guardado) el siguiente AA aplica el daño de esta pasiva 110/120/130/140 % AD (automático al objetivo del AA) y golpea el área cercana (elige zona a mano). Cura 2,6/3,7176/4,8353/5,9529 + 30 % AP por enemigo alcanzado (wiki Umbra Blades: 13–32 según nivel 1–18 + 30 % AP, ÷5 sin redondear, interpolado en tramos 1/6/11/16; automático al del AA; el resto del área, a mano). Los AA reducen el CD 1 t. (wiki: 1 s; contra campeones 3 s → 2 t., a mano si quieres quitar 2).',
    fields: {
      mechanics: {
        noAction: true,
        empoweredAa: {
          cooldown: [6],
          reduceOnAuto: 1,
          applyAbilityDamage: true,
          healPerTarget: true,
          heal: {
            flat: [2.6, 3.7176470588, 4.8352941176, 5.9529411765],
            flatByLevel: true,
            selfRatios: [{ stat: 'ap', values: [30] }],
          },
        },
      },
    },
  },
  {
    champion: 'Nocturne',
    slot: 'Q',
    name: 'Portador del anochecer',
    description:
      'Lanza una espada: daño físico 75/80/85/90/95 % AD bonus (automático). Deja un rastro 3 t. (5 s ÷ 2, redondeo hacia arriba). Si marcas «Estoy en el rastro» al usarla, o pulsas el botón mientras el rastro dure, ganas Fantasmal, +20/25/30/35/40 % de SPE y +3/5/7/9/11 AD 3 t. (wiki Duskbringer: +15/25/35/45/55 AD y 20–40 % MS, ghosted; el AD de LoL se convierte ÷5 sin redondear, en la escala plana de los ítems, p. ej. Martillo de Caulfield 2d2 ≈ 3). El área y quién deja rastro, a mano.',
    fields: {
      mechanics: {
        selfInArea: true,
        selfInAreaLabel: 'Estoy en el rastro',
        trailTurns: 3,
        selfStatuses: [
          { name: 'Fantasmal', turns: 3, blocksAbility: false, requiresSelfInArea: true },
          { name: 'Velocidad de movimiento', turns: 3, stat: 'spe', pctValues: [20, 25, 30, 35, 40], blocksAbility: false, requiresSelfInArea: true },
          { name: 'AD del rastro', turns: 3, stat: 'ad', amountValues: [3, 5, 7, 9, 11], blocksAbility: false, requiresSelfInArea: true },
        ],
      },
    },
  },
  {
    champion: 'Nocturne',
    slot: 'E',
    name: 'Horror inenarrable',
    description:
      'Vínculo 1 t. (2 s ÷ 2): al usarla inflige el daño mágico 40/45/50/55/60 % AP ya configurado (no se sustituye el 100 % AP de la wiki; automático; sin miedo inmediato). Si al acabar sigue a alcance, pulsa «Detonar» (elige al objetivo) para aplicar Miedo 1/1/1/1/2 t. (wiki 1,25/1,5/1,75/2/2,25 s ÷ 2, redondeo hacia arriba). Si se alejó, cancela o Detonar sin objetivos.',
    fields: {
      effectTarget: null,
      effectName: null,
      effectDuration: null,
      effect: [{ name: 'Miedo', duration: [1, 1, 1, 1, 2] }],
      mechanics: {
        trap: {
          turns: 1,
          name: 'Horror inenarrable',
          applyOnPlace: true,
          damageOnDetonate: false,
          eruptEffect: [{ name: 'Miedo', duration: [1, 1, 1, 1, 2] }],
        },
      },
    },
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-players-fix-write`);
  if (!dry) {
    mkdirSync(dir, { recursive: true });
    const all = await col.find({}).toArray();
    writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
    console.log(`Copia previa a escribir: ${dir} (${all.length} campeones)`);
  }

  for (const patch of PATCHES) {
    const doc = await col.findOne({ champion: patch.champion });
    if (!doc) throw new Error(`${patch.champion} no está en la base`);
    const existing = { ...((doc.abilities?.[patch.slot] ?? {}) as Loose) };
    if (existing.name && existing.name !== patch.name) {
      throw new Error(`${patch.champion} ${patch.slot} se llama «${existing.name}», se esperaba «${patch.name}»`);
    }
    const merged: Loose = { ...existing, ...patch.fields, name: patch.name, description: patch.description };
    // Quitar campos que deben desaparecer (Nocturne E: no aplicar miedo al lanzar).
    if (patch.fields && Object.prototype.hasOwnProperty.call(patch.fields, 'effectTarget') && patch.fields.effectTarget == null) delete merged.effectTarget;
    if (patch.fields && Object.prototype.hasOwnProperty.call(patch.fields, 'effectName') && patch.fields.effectName == null) delete merged.effectName;
    if (patch.fields && Object.prototype.hasOwnProperty.call(patch.fields, 'effectDuration') && patch.fields.effectDuration == null) delete merged.effectDuration;
    const parsed = parseChampionAbilityPatch({ slot: patch.slot, ability: merged as ChampionAbility }).ability;
    console.log(`\n${patch.champion} ${patch.slot} «${patch.name}»`);
    console.log(`  mechanics: ${JSON.stringify(parsed.mechanics ?? {})}`);
    if (dry) continue;
    await col.updateOne({ _id: doc._id }, { $set: { [`abilities.${patch.slot}`]: parsed, updatedAt: new Date().toISOString() } });
    console.log('  escrito');
  }

  if (dry) console.log('\n[dry] nada escrito');
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
