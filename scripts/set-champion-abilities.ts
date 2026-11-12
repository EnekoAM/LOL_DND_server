/**
 * Habilidades de campeón desde wiki.leagueoflegends.com (15 campeones con habilidades aprendidas por los jugadores).
 * Reglas de Eneko: ratio de rango 3 = ratio de la wiki, ±0.05 por rango (R: ratio de la wiki y +0.1 por rango); base plana fuera;
 * multiplicador a un solo objetivo → damageBonus; daño por % de vida / ejecuciones → texto + a mano; coste y segundos ÷2 (mitades
 * hacia arriba; duraciones de efecto mín. 1; cooldown = rango central); 1 casilla = 200 u (redondeo, mín. 1); áreas solo donde no
 * hay; appliesOnHit solo si la wiki dice on-hit; huecos que faltan se crean con el nombre inglés de la wiki.
 * NUNCA pisa lo que ya hay: solo rellena campos vacíos y lista los conflictos. Copia champions en backups/<fecha>-champion-abilities/.
 *   npx tsx scripts/set-champion-abilities.ts --dry   |   npx tsx scripts/set-champion-abilities.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';
import { parseChampionAbilityPatch, type ChampionAbility, type ChampionAbilityDamage, type ChampionAbilityEffect, type ChampionAbilityVariant, type ChampionSlot } from '../src/validate';
import type { AreaPattern } from '../src/areaPattern';
import type { ResourceId } from '../src/resources';

type Slot = 'P' | 'Q' | 'W' | 'E' | 'R';
type Dmg = { type?: 'physical' | 'magic'; ad?: number; ap?: number; adSource?: 'total' | 'bonus'; apSource?: 'total' | 'bonus'; damageBonus?: number };
type Fx = { name: string; pct?: number[]; sec?: number[] };
type AreaSpec =
  | { kind: 'self'; r: number }
  | { kind: 'line'; len: number; half?: number }
  | { kind: 'cone'; len: number; deg: number }
  | { kind: 'target'; range: number; r: number }
  | { kind: 'wall'; range: number; len: number }
  | { kind: 'x'; range: number; arm: number };
type VariantCfg = { name: string; desc?: string; dmg?: Dmg; fx?: Fx[]; enemy?: { name: string; sec: number } };
type Cfg = {
  name: string;
  desc?: string;
  dmg?: Dmg;
  cost?: number[];
  resource?: ResourceId;
  cd?: number[];
  fx?: Fx[];
  enemy?: { name: string; sec: number };
  selfSec?: number;
  area?: AreaSpec;
  stacks?: number;
  onHit?: true;
  variants?: VariantCfg[];
  manual?: string[];
};
type ChampCfg = { resource: ResourceId; slots: Partial<Record<Slot, Cfg>>; skip?: Partial<Record<Slot, string>> };

const DATA: Record<string, ChampCfg> = {
  Ashe: {
    resource: 'mana',
    slots: {
      P: { name: 'Frost Shot', fx: [{ name: 'Ralentización', pct: [20], sec: [2] }], manual: ['Ralentización 20–30 % según nivel; los críticos ralentizan más'] },
      Q: { name: "Ranger's Focus", dmg: { type: 'physical', ad: 1.2, adSource: 'total' }, fx: [{ name: 'Velocidad de ataque', pct: [20, 30, 40, 50, 60], sec: [6] }], selfSec: 6, stacks: 4, manual: ['Se activa con 4 cargas de Concentración; cada básico dispara 5 flechas (daño total por ráfaga)'] },
      W: { name: 'Volley', cd: [18, 14.5, 11, 7.5, 4], area: { kind: 'cone', len: 1200, deg: 25 }, manual: ['7–11 flechas; un enemigo solo recibe el daño de la primera; aplica Tiro Congelante'] },
      E: { name: 'Hawkshot', manual: ['Halcón explorador global, sin daño: a mano'] },
      R: { name: 'Enchanted Crystal Arrow', dmg: { type: 'magic', ap: 1.2, apSource: 'total' }, cd: [100, 80, 60], fx: [{ name: 'Aturdimiento', sec: [1] }], enemy: { name: 'Aturdimiento', sec: 1 }, area: { kind: 'line', len: 2000 }, manual: ['Global; aturdimiento 1–3.5 s según distancia (1–2 turnos); los enemigos alrededor reciben el mismo daño + Tiro Congelante'] },
    },
  },
  Aurora: {
    resource: 'mana',
    slots: {
      P: { name: 'Spirit Abjuration', desc: 'Sus básicos y habilidades de daño aplican una carga (máx. 3). La tercera consume todas e inflige daño mágico adicional según la vida máxima del objetivo; contra campeones libera un espíritu que la cura cada turno.', stacks: 3, manual: ['Daño 1 % (+2.7 % por 100 AP) de la vida máx.: a mano', 'Curación por espíritu: a mano'] },
      Q: { name: 'Twofold Hex', desc: 'Lanza un proyectil que inflige daño mágico y marca a los enemigos. Al relanzar, las marcas vuelven hacia ella dañando a los enemigos que atraviesan; el daño aumenta según la vida que les falta.', dmg: { type: 'magic', ap: 0.4, apSource: 'total' }, cost: [60], cd: [9, 8.5, 8, 7.5, 7], area: { kind: 'line', len: 900 }, manual: ['Relanzamiento: +0–50 % según vida faltante del objetivo: a mano'] },
      W: { name: 'Across the Veil', cd: [22, 21, 20, 19, 18], fx: [{ name: 'Invisibilidad', sec: [1, 1.15, 1.3, 1.45, 1.6] }, { name: 'Velocidad de movimiento', pct: [20, 25, 30, 35, 40], sec: [4] }], selfSec: 4, manual: ['Salto de 300 u (2 casillas); se reinicia con un derribo en 3 s'] },
      E: { name: 'The Weirding', desc: 'Dispara una ráfaga en línea que inflige daño mágico y ralentiza mucho a los enemigos alcanzados; ella retrocede en dirección contraria.', dmg: { type: 'magic', ap: 0.7, apSource: 'total' }, cost: [80], cd: [15, 14, 13, 12, 11], fx: [{ name: 'Ralentización', pct: [80], sec: [1] }], enemy: { name: 'Ralentización', sec: 1 }, area: { kind: 'line', len: 825 }, manual: ['Retroceso de 250 u (1 casilla)'] },
      R: { name: 'Between Worlds', desc: 'Salta y libera una onda que inflige daño mágico y ralentiza; deja una grieta circular: si ella toca el borde cruza al lado opuesto, si un enemigo lo toca queda ralentizado.', dmg: { type: 'magic', ap: 0.7, apSource: 'total' }, cost: [100], cd: [140, 120, 100], fx: [{ name: 'Ralentización', pct: [30], sec: [2] }, { name: 'Ralentización (borde)', pct: [50], sec: [1.5, 1.75, 2] }], enemy: { name: 'Ralentización', sec: 2 }, area: { kind: 'target', range: 450, r: 700 }, manual: ['Grieta 2.25–3.25 s; Realm Hopper 4–5 s: a mano'] },
    },
  },
  Fiddlesticks: {
    resource: 'mana',
    slots: {
      P: { name: 'A Harmless Scarecrow', manual: ['Espantapájaros / dron barredor: a mano'] },
      Q: { name: 'Terrify', cd: [15, 14.5, 14, 13.5, 13], enemy: { name: 'Miedo', sec: 1.6 }, manual: ['Daño 4–6 % (+3 % por 100 AP) de la vida actual (doble si ya tenía miedo): a mano'] },
      W: { name: 'Bountiful Harvest', dmg: { type: 'magic', ap: 0.9, apSource: 'total' }, cd: [10, 9.5, 9, 8.5, 8], fx: [{ name: 'Curación', pct: [25, 32.5, 40, 47.5, 55] }], area: { kind: 'self', r: 650 }, manual: ['Último tick +12–22 % de la vida faltante: a mano', 'Canaliza 2 s; si no se interrumpe devuelve el 60 % del cooldown'] },
      E: { name: 'Reap', cd: [10, 9, 8, 7, 6], enemy: { name: 'Ralentización', sec: 1.25 } },
      R: { name: 'Crowstorm', dmg: { type: 'magic', ap: 2.5, apSource: 'total' }, cd: [140, 110, 80], area: { kind: 'target', range: 800, r: 600 }, manual: ['Canaliza 1.5 s y parpadea; los cuervos duran 5 s (3 turnos): daño total repartido'] },
    },
  },
  Hwei: {
    resource: 'mana',
    slots: {
      P: { name: 'Signature of the Visionary', desc: 'Sus habilidades de daño marcan a los enemigos. Dañarlos con otra habilidad distinta consume la marca y provoca una explosión que inflige daño mágico en área.' },
      Q: {
        name: 'Subject: Disaster', desc: 'Elige una de sus tres habilidades de desastre.', cd: [10, 9, 8, 7, 6],
        variants: [
          { name: 'Devastating Fire', desc: 'Bola de fuego que explota al primer impacto e inflige daño mágico en área.', dmg: { type: 'magic', ap: 0.8, apSource: 'total' } },
          { name: 'Severing Bolt', desc: 'Rayo en la zona objetivo; contra un enemigo aislado o inmovilizado hace más daño según su vida faltante.', dmg: { type: 'magic', ap: 0.3, apSource: 'total' } },
          { name: 'Molten Fissure', desc: 'Camino de explosiones que deja grietas volcánicas que dañan y ralentizan.', dmg: { type: 'magic', ap: 0.3, apSource: 'total' } },
        ],
        manual: ['Devastating Fire +3–7 % de la vida máx.: a mano', 'Severing Bolt: hasta +200–350 % según vida faltante (aislado/inmovilizado): a mano', 'Molten Fissure: daño por tick de la grieta y ralentización: a mano'],
      },
      W: {
        name: 'Subject: Serenity', desc: 'Elige una de sus tres habilidades de serenidad.', cd: [18, 17.5, 17, 16.5, 16],
        variants: [
          { name: 'Fleeting Current', desc: 'Corriente que da velocidad de movimiento y fantasmal a él y sus aliados.', fx: [{ name: 'Velocidad de movimiento', pct: [30, 32.5, 35, 37.5, 40], sec: [4, 4.5, 5, 5.5, 6] }] },
          { name: 'Pool of Reflection', desc: 'Charco protector que escuda a él y a sus aliados mientras están dentro.', fx: [{ name: 'Escudo', sec: [3] }] },
          { name: 'Stirring Lights', desc: 'Sus 3 siguientes básicos o impactos de habilidad infligen daño mágico adicional y le devuelven maná.', dmg: { type: 'magic', ap: 0.15, apSource: 'total' } },
        ],
        manual: ['Escudo de Pool of Reflection (30 % AP inicial, hasta 60 % AP): a mano', 'Stirring Lights: maná devuelto por impacto: a mano'],
      },
      E: {
        name: 'Subject: Torment', desc: 'Elige una de sus tres habilidades de tormento.', cd: [12, 11.5, 11, 10.5, 10],
        variants: [
          { name: 'Grim Visage', desc: 'Rostro que inflige daño mágico al primer enemigo y le causa miedo.', dmg: { type: 'magic', ap: 0.65, apSource: 'total' }, fx: [{ name: 'Miedo', sec: [1, 1.125, 1.25, 1.375, 1.5] }], enemy: { name: 'Miedo', sec: 1.25 } },
          { name: 'Gaze of the Abyss', desc: 'Ojo que se fija en el enemigo más cercano, le inflige daño mágico y lo enraíza.', dmg: { type: 'magic', ap: 0.65, apSource: 'total' }, fx: [{ name: 'Enraizamiento', sec: [1.2, 1.4, 1.6, 1.8, 2] }], enemy: { name: 'Enraizamiento', sec: 1.6 } },
          { name: 'Crushing Maw', desc: 'Fauces que se cierran en la zona, infligen daño mágico y ralentizan.', dmg: { type: 'magic', ap: 0.65, apSource: 'total' }, fx: [{ name: 'Ralentización', pct: [40, 47.5, 55, 62.5, 70], sec: [1.25] }], enemy: { name: 'Ralentización', sec: 1.25 } },
        ],
      },
      R: { name: 'Spiraling Despair', desc: 'Lanza un orbe que se adhiere al primer campeón y crea un aura que crece, ralentiza y daña a los enemigos cercanos; al final explota.', dmg: { type: 'magic', ap: 0.95, apSource: 'total' }, cd: [120, 100, 80], fx: [{ name: 'Ralentización', pct: [10], sec: [0.25] }], area: { kind: 'target', range: 1340, r: 500 }, manual: ['Ralentización 10 % por carga de Desesperación, hasta 12 cargas: a mano'] },
    },
  },
  'Jarvan IV': {
    resource: 'mana',
    slots: {
      P: { name: 'Martial Cadence', manual: ['Daño 8 % de la vida actual del objetivo (mín. 20): a mano'] },
      Q: { name: 'Dragon Strike', dmg: { type: 'physical', ad: 1.45, adSource: 'bonus' }, cd: [10, 9, 8, 7, 6], fx: [{ name: 'Reducción de armadura', pct: [10, 14, 18, 22, 26], sec: [3] }], enemy: { name: 'Reducción de armadura', sec: 3 }, area: { kind: 'line', len: 785 }, manual: ['Si toca el Estandarte: salta hasta él y levanta a los enemigos (0.75 s)'] },
      R: { name: 'Cataclysm', dmg: { type: 'physical', ad: 1.8, adSource: 'bonus' }, cd: [120, 105, 90], area: { kind: 'target', range: 650, r: 350 }, manual: ['Anillo de terreno infranqueable 3.5 s (2 turnos): a mano'] },
    },
    skip: {
      W: 'Nombre/descr. «Estandarte Demaciano» (= E de la wiki) pero coste 15 = Golden Aegis (W de la wiki): no se toca',
      E: '«Demacian Standard» con descr. de desplazamiento; Golden Aegis (escudo 60–140 +70 % AD bonus, ralentiza 15–35 %) no tiene hueco: no se toca',
    },
  },
  Karthus: {
    resource: 'mana',
    slots: {
      P: { name: 'Death Defied', manual: ['Estado zombi 7 s (4 turnos) tras morir, habilidades sin coste: a mano'] },
      Q: { name: 'Lay Waste', cd: [1] },
      W: { name: 'Wall of Pain', cd: [15], fx: [{ name: 'Ralentización', pct: [40, 50, 60, 70, 80], sec: [5] }, { name: 'Reducción de resistencia mágica', pct: [25], sec: [5] }], enemy: { name: 'Ralentización', sec: 5 }, area: { kind: 'wall', range: 1000, len: 1000 }, manual: ['Muro de 800–1200 u (se dibujó el de rango 3); la ralentización decae'] },
      E: { name: 'Defile', dmg: { type: 'magic', ap: 0.2, apSource: 'total' }, cd: [0.5], area: { kind: 'self', r: 550 }, manual: ['Alterna: coste y daño por segundo; recupera 10–50 de maná al matar: a mano'] },
      R: { name: 'Requiem', dmg: { type: 'magic', ap: 0.7, apSource: 'total' }, cd: [200, 180, 160], manual: ['Global: todos los campeones enemigos tras canalizar 3 s (2 turnos)'] },
    },
  },
  Nocturne: {
    resource: 'mana',
    slots: {
      P: { name: 'Umbra Blades', manual: ['Curación 13–32 (+30 % AP) por enemigo: a mano'] },
      Q: { name: 'Duskbringer', cd: [8], fx: [{ name: 'Velocidad de movimiento', pct: [20, 25, 30, 35, 40] }], manual: ['+15–55 de AD en el rastro: a mano'] },
      W: { name: 'Shroud of Darkness', cd: [20, 18, 16, 14, 12], fx: [{ name: 'Velocidad de ataque', pct: [30, 35, 40, 45, 50] }, { name: 'Escudo de hechizos', sec: [1.5] }], selfSec: 1.5, manual: ['Si bloquea algo dobla la velocidad de ataque 5 s'] },
      E: { name: 'Unspeakable Horror', dmg: { type: 'magic', ap: 1, apSource: 'total' }, cd: [15, 14, 13, 12, 11], fx: [{ name: 'Miedo', sec: [1.25, 1.5, 1.75, 2, 2.25] }], enemy: { name: 'Miedo', sec: 1.75 }, manual: ['Miedo solo si el objetivo no rompe el vínculo en 2 s'] },
      R: { name: 'Paranoia', dmg: { type: 'physical', ad: 1.2, adSource: 'bonus' }, cd: [160, 130, 100], fx: [{ name: 'Miopía', sec: [6] }], manual: ['Miopía global a todos los campeones enemigos; salto de 2500–4000 u'] },
    },
  },
  Pyke: {
    resource: 'mana',
    slots: {
      P: { name: 'Gift of the Drowned Ones', manual: ['Vida gris y conversión de vida bonus en AD: a mano'] },
      Q: { name: 'Bone Skewer', desc: 'Carga el arpón y lo lanza: inflige daño físico al primer enemigo, lo atrae y lo ralentiza. Si lo suelta enseguida apuñala al enemigo más cercano.', dmg: { type: 'physical', ad: 0.75, adSource: 'bonus' }, cost: [70, 75, 80, 85, 90], cd: [10, 9.5, 9, 8.5, 8], fx: [{ name: 'Atracción' }, { name: 'Ralentización', pct: [90], sec: [1] }], enemy: { name: 'Ralentización', sec: 1 }, area: { kind: 'line', len: 1100 }, manual: ['Alcance 400–1100 u según la carga'] },
      W: { name: 'Ghostwater Dive', desc: 'Se sumerge: camuflaje y velocidad de movimiento que decae.', cost: [65], cd: [14, 13, 12, 11, 10], fx: [{ name: 'Camuflaje', sec: [5] }, { name: 'Velocidad de movimiento', pct: [45], sec: [5] }], selfSec: 5, manual: ['+2 % de velocidad por punto de letalidad: a mano'] },
      E: { name: 'Phantom Undertow', desc: 'Se desplaza dejando un fantasma que vuelve hacia él, aturdiendo e infligiendo daño físico a los enemigos que atraviesa.', dmg: { type: 'physical', ad: 1, adSource: 'bonus' }, cost: [40], cd: [15, 14, 13, 12, 11], fx: [{ name: 'Aturdimiento', sec: [1.25] }], enemy: { name: 'Aturdimiento', sec: 1.25 }, area: { kind: 'line', len: 550 } },
      R: { name: 'Death from Below', desc: 'Golpea una zona en forma de X: ejecuta a los campeones con poca vida y daña al resto. Si mata, puede relanzarla gratis.', dmg: { type: 'physical', ad: 0.4, adSource: 'bonus' }, cost: [100], cd: [100, 85, 70], area: { kind: 'x', range: 750, arm: 1 }, manual: ['Ejecución por debajo de 250–550 (+80 % AD bonus) de vida: a mano', 'Relanzamiento gratis si alguien muere en la X'] },
    },
  },
  Sett: {
    resource: 'coraje',
    slots: {
      P: { name: 'Pit Grit', desc: 'Alterna puñetazo izquierdo y derecho (el derecho es más rápido y fuerte). Regenera más vida cuanta más le falte.', manual: ['Regeneración según vida faltante: a mano'] },
      Q: { name: 'Knuckle Down', desc: 'Sus dos siguientes básicos infligen daño físico adicional según la vida máxima del objetivo; gana velocidad de movimiento hacia campeones enemigos.', dmg: { type: 'physical', ad: 1, adSource: 'total' }, resource: 'ninguno', cd: [9, 8, 7, 6, 5], fx: [{ name: 'Velocidad de movimiento', pct: [30], sec: [1.5] }], stacks: 2, manual: ['+1 % (+1–3 % por 100 AD) de la vida máx. por golpe: a mano'] },
      W: { name: 'Haymaker', desc: 'Gasta todo el coraje: se escuda con lo gastado y da un puñetazo en línea; daño verdadero en el centro, físico en los lados.', resource: 'coraje', cd: [18, 16.5, 15, 13.5, 12], fx: [{ name: 'Escudo', sec: [3] }], area: { kind: 'line', len: 720, half: 1 }, manual: ['Daño 25 % (+25 % por 100 AD bonus) del coraje gastado; escudo = coraje gastado: a mano'] },
      E: { name: 'Facebreaker', dmg: { type: 'physical', ad: 0.6, adSource: 'total' }, cd: [16, 14.5, 13, 11.5, 10], fx: [{ name: 'Ralentización', pct: [70], sec: [0.5] }, { name: 'Aturdimiento', sec: [1] }], enemy: { name: 'Aturdimiento', sec: 1 }, manual: ['Solo aturde si atrae enemigos de ambos lados'] },
      R: { name: 'The Show Stopper', desc: 'Agarra a un campeón enemigo, lo arrastra y lo estampa contra el suelo, dañando a los enemigos de la zona de caída.', dmg: { type: 'physical', ad: 1.2, adSource: 'bonus' }, resource: 'ninguno', cd: [120, 100, 80], fx: [{ name: 'Supresión', sec: [1] }, { name: 'Ralentización', pct: [99], sec: [1] }], area: { kind: 'target', range: 400, r: 600 }, manual: ['+40–60 % de la vida bonus del objetivo principal: a mano'] },
    },
  },
  Talon: {
    resource: 'mana',
    slots: {
      P: { name: "Blade's End", desc: 'Sus habilidades aplican Herida (máx. 3). Su siguiente básico contra un objetivo con 3 cargas lo hace sangrar con daño físico.', dmg: { type: 'physical', ad: 2.1, adSource: 'bonus' }, fx: [{ name: 'Sangrado', sec: [2] }], stacks: 3 },
      Q: { name: 'Noxian Diplomacy', desc: 'Salta al objetivo y lo apuñala con daño físico; cuerpo a cuerpo, el golpe es crítico.', dmg: { type: 'physical', ad: 1, adSource: 'bonus' }, cost: [40], cd: [8, 7.5, 7, 6.5, 6], manual: ['A melé crítico ×1.5 (150 % AD bonus)'] },
      W: { name: 'Rake', desc: 'Lanza dagas en abanico que vuelven hacia él, infligiendo daño físico a la ida y a la vuelta y ralentizando.', dmg: { type: 'physical', ad: 1.3, adSource: 'bonus' }, cost: [50, 55, 60, 65, 70], cd: [9, 8.5, 8, 7.5, 7], fx: [{ name: 'Ralentización', pct: [40, 45, 50, 55, 60], sec: [1] }], enemy: { name: 'Ralentización', sec: 1 }, area: { kind: 'cone', len: 900, deg: 25 }, manual: ['Daño de ida y vuelta (40 % + 90 % AD bonus)'] },
      E: { name: "Assassin's Path", cd: [2], manual: ['El mismo muro: 160–60 s de espera'] },
      R: { name: 'Shadow Assault', desc: 'Dispersa un anillo de cuchillas, se vuelve invisible y rápido; las cuchillas vuelven a él dañando otra vez.', dmg: { type: 'physical', ad: 2, adSource: 'bonus' }, cost: [100], cd: [100, 80, 60], fx: [{ name: 'Invisibilidad', sec: [2.5] }, { name: 'Velocidad de movimiento', pct: [40, 55, 70], sec: [2.5] }], selfSec: 2.5, area: { kind: 'self', r: 550 } },
    },
  },
  Trundle: {
    resource: 'mana',
    slots: {
      P: { name: "King's Tribute", manual: ['Cura 1.8–5.94 % de la vida máx. del enemigo que muere: a mano'] },
      Q: { name: 'Chomp', desc: 'Su siguiente básico muerde: daño físico adicional, ralentiza y le roba daño de ataque al objetivo.', dmg: { type: 'physical', ad: 0.35, adSource: 'total' }, cost: [20], cd: [3.5], fx: [{ name: 'Ralentización', pct: [75], sec: [0.1] }], manual: ['+20–40 AD para él y −10–20 AD al objetivo durante 5 s: a mano'] },
      W: { name: 'Frozen Domain', desc: 'Congela una zona: dentro gana velocidad de ataque, velocidad de movimiento y curación aumentada.', cost: [40], cd: [18, 17, 16, 15, 14], fx: [{ name: 'Velocidad de ataque', pct: [30, 50, 70, 90, 110], sec: [8] }, { name: 'Velocidad de movimiento', pct: [20, 28, 36, 44, 52], sec: [8] }], selfSec: 8, area: { kind: 'target', range: 750, r: 775 }, manual: ['Solo mientras esté dentro de la zona'] },
      E: { name: 'Pillar of Ice', desc: 'Levanta un pilar de hielo que empuja a los enemigos y ralentiza a los cercanos.', cost: [75], cd: [21, 19.5, 18, 16.5, 15], fx: [{ name: 'Ralentización', pct: [34, 38, 42, 46, 50], sec: [6] }], enemy: { name: 'Ralentización', sec: 6 }, area: { kind: 'target', range: 1000, r: 360 } },
      R: { name: 'Subjugate', desc: 'Drena a un campeón enemigo: daño mágico y curación según su vida máxima, y le roba armadura y resistencia mágica.', dmg: { type: 'magic' }, cost: [100], cd: [120, 100, 80], manual: ['20–30 % (+2 % por 100 AP) de la vida máx. como daño y curación (mitad al instante, mitad en 4 s): a mano', 'Robo de resistencias: a mano'] },
    },
  },
  Vi: {
    resource: 'mana',
    slots: {
      P: { name: 'Blast Shield', desc: 'Cada cierto tiempo, su siguiente impacto de habilidad le da un escudo según su vida máxima.', cd: [14], manual: ['Escudo 10 % de la vida máx. 3 s; cooldown 16–12 s según nivel'] },
      Q: { name: 'Vault Breaker', desc: 'Carga un puñetazo y se lanza hacia delante, infligiendo daño físico y derribando al primer campeón que golpea.', dmg: { type: 'physical', ad: 1.5, adSource: 'bonus' }, cost: [50, 60, 70, 80, 90], cd: [12, 10.5, 9, 7.5, 6], fx: [{ name: 'Empuje', sec: [0.75] }], area: { kind: 'line', len: 725 }, manual: ['Ratio = carga máxima; sin cargar 60 % AD bonus; alcance 250–725 u'] },
      W: { name: 'Denting Blows', fx: [{ name: 'Reducción de armadura', pct: [20], sec: [4] }, { name: 'Velocidad de ataque', pct: [30, 35, 40, 45, 50], sec: [4] }], manual: ['4–8 % (+3.5 % por 100 AD bonus) de la vida máx. al tercer golpe: a mano'] },
      E: { name: 'Relentless Force', desc: 'Su siguiente básico explota en cono detrás del objetivo, infligiendo daño físico a los enemigos.', dmg: { type: 'physical', ad: 1.1, adSource: 'total', ap: 1, apSource: 'total' }, cost: [26, 32, 38, 44, 50], cd: [12, 11, 10, 9, 8], area: { kind: 'cone', len: 600, deg: 30 }, manual: ['2 cargas (recarga = cooldown)'] },
      R: { name: 'Cease and Desist', desc: 'Persigue a un campeón enemigo, imparable, y lo lanza por los aires; aparta y aturde a los que atraviesa.', dmg: { type: 'physical', ad: 0.9, adSource: 'bonus' }, cost: [100], cd: [140, 115, 90], fx: [{ name: 'Levantamiento', sec: [1.3] }, { name: 'Aturdimiento', sec: [0.75] }], enemy: { name: 'Levantamiento', sec: 1.3 } },
    },
  },
  Warwick: {
    resource: 'mana',
    slots: {
      P: { name: 'Eternal Hunger', desc: 'Sus básicos infligen daño mágico adicional. Con poca vida se cura con ese daño.', dmg: { type: 'magic', ad: 0.15, adSource: 'bonus', ap: 0.1, apSource: 'total' }, manual: ['Cura 100 % de ese daño bajo 50 % de vida (250 % bajo 25 %): a mano'] },
      Q: { name: 'Jaws of the Beast', dmg: { type: 'magic', ad: 1.2, adSource: 'total', ap: 1, apSource: 'total' }, cd: [8, 7.5, 7, 6.5, 6], fx: [{ name: 'Curación', pct: [25, 37.5, 50, 62.5, 75] }], onHit: true, manual: ['6–10 % de la vida máx. del objetivo: a mano', 'Cura % del daño infligido; mantener = salta tras el objetivo'] },
      W: { name: 'Blood Hunt', desc: 'Gana velocidad de ataque contra enemigos con menos de la mitad de vida. Activa: marca al campeón enemigo más cercano y gana velocidad de movimiento hacia él.', cost: [55], cd: [80, 70, 60, 50, 40], fx: [{ name: 'Velocidad de ataque', pct: [70, 80, 90, 100, 110] }, { name: 'Velocidad de movimiento', pct: [35, 42.5, 50, 57.5, 65], sec: [8] }], selfSec: 8, manual: ['Pasiva solo contra objetivos bajo el 50 % de vida; activa duplicada'] },
      E: { name: 'Primal Howl', desc: 'Gana reducción de daño; al terminar aúlla y causa miedo a los enemigos cercanos.', cost: [40], cd: [15, 14, 13, 12, 11], fx: [{ name: 'Reducción de daño', pct: [35, 40, 45, 50, 55], sec: [2.75] }, { name: 'Miedo', sec: [1] }], selfSec: 2.75, area: { kind: 'self', r: 375 } },
      R: { name: 'Infinite Duress', desc: 'Salta en una dirección y suprime al primer campeón que alcanza, infligiendo daño mágico y curándose.', dmg: { type: 'magic', ad: 1.67, adSource: 'bonus' }, cost: [100], cd: [110, 90, 70], fx: [{ name: 'Supresión', sec: [1.5] }], enemy: { name: 'Supresión', sec: 1.5 }, area: { kind: 'line', len: 840 }, manual: ['Alcance = 250 % de su velocidad de movimiento (dibujado ~840 u)', 'Cura el 100 % del daño'] },
    },
  },
  'Xin Zhao': {
    resource: 'mana',
    slots: {
      P: { name: 'Determination', manual: ['Curación 2–5 % de la vida máx. (+AP) al tercer golpe: a mano'] },
      Q: { name: 'Three Talon Strike', cd: [7, 6.5, 6, 5.5, 5] },
      W: { name: 'Wind Becomes Lightning', cd: [12, 11, 10, 9, 8] },
      E: { name: 'Audacious Charge', cd: [11], fx: [{ name: 'Ralentización', pct: [30], sec: [0.5] }, { name: 'Velocidad de ataque', pct: [38, 46, 54, 62, 70], sec: [5] }] },
      R: { name: 'Crescent Guard', cd: [120, 110, 100], fx: [{ name: 'Empuje', sec: [0.75] }, { name: 'Aturdimiento', sec: [0.75] }], manual: ['+15 % de la vida actual del objetivo: a mano', 'Invulnerable 4 s ante campeones lejanos'] },
    },
  },
  Zed: {
    resource: 'energia',
    slots: {
      P: { name: 'Contempt for the Weak', desc: 'Sus básicos contra objetivos con menos de la mitad de vida infligen daño mágico adicional según su vida máxima.', cd: [10], manual: ['5–10 % de la vida máx. según nivel: a mano'] },
      Q: { name: 'Razor Shuriken', desc: 'Lanza un shuriken (él y sus sombras) que inflige daño físico; los enemigos siguientes reciben menos.', dmg: { type: 'physical', ad: 1, adSource: 'bonus' }, cost: [75, 70, 65, 60, 55], cd: [6], area: { kind: 'line', len: 925 }, manual: ['Tras el primer impacto el daño baja al 60 %; las sombras lo repiten'] },
      W: { name: 'Living Shadow', desc: 'Envía una sombra que imita sus habilidades; puede recastear para intercambiar posición con ella.', cost: [40, 35, 30, 25, 20], cd: [20, 19, 18, 17, 16], selfSec: 5.25, manual: ['Sombra 5.25 s; recupera 30–50 de energía si la sombra y él golpean al mismo objetivo'] },
      E: { name: 'Shadow Slash', dmg: { type: 'physical', ad: 0.7, adSource: 'bonus' }, cost: [40], cd: [5, 4.5, 4, 3.5, 3], fx: [{ name: 'Ralentización', pct: [20, 25, 30, 35, 40], sec: [1.5] }], enemy: { name: 'Ralentización', sec: 1.5 }, manual: ['Cada campeón golpeado reduce 3 s el cooldown de la W'] },
      R: { name: 'Death Mark', desc: 'Se vuelve intangible, salta tras un campeón enemigo y lo marca; al cabo de 3 s la marca detona con parte del daño infligido.', dmg: { type: 'physical', ad: 1, adSource: 'total' }, resource: 'ninguno', cd: [120, 110, 100], manual: ['Detonación +25/40/55 % del daño acumulado: a mano'] },
    },
  },
};

// ---------- conversiones ----------
const RANKS: Record<Slot, number> = { P: 1, Q: 5, W: 5, E: 5, R: 3 };
const r2 = (n: number) => Math.round(n * 100) / 100;
const half = (n: number) => Math.round(n / 2); // mitades hacia arriba (positivos)
const turns = (sec: number) => Math.max(1, half(sec));
const squares = (units: number) => Math.max(1, Math.round(units / 200));
const middle = (list: number[]) => list[Math.floor((list.length - 1) / 2)];
const collapse = (list: number[]) => (list.every(v => v === list[0]) ? [list[0]] : list);

function ratios(wiki: number, slot: Slot): number[] {
  if (slot === 'P') return [r2(wiki)];
  if (slot === 'R') return [0, 1, 2].map(i => r2(wiki + 0.1 * i));
  return [-2, -1, 0, 1, 2].map(i => r2(Math.max(0.01, wiki + 0.05 * i)));
}
function damage(d: Dmg, slot: Slot): ChampionAbilityDamage {
  const out: ChampionAbilityDamage = {};
  if (d.type) out.type = d.type;
  if (d.ap !== undefined) { out.ap = ratios(d.ap, slot); out.apSource = d.apSource ?? 'total'; }
  if (d.ad !== undefined) { out.ad = ratios(d.ad, slot); out.adSource = d.adSource ?? 'total'; }
  if (d.damageBonus !== undefined) out.damageBonus = d.damageBonus;
  return out;
}
function effects(list: Fx[]): ChampionAbilityEffect[] {
  return list.map(f => {
    const e: ChampionAbilityEffect = { name: f.name };
    if (f.pct) e.values = collapse(f.pct.map(p => r2(p / 100)));
    if (f.sec) e.duration = collapse(f.sec.map(turns));
    return e;
  });
}
const costText = (list: number[]) => collapse(list.map(half)).join('/');

function area(spec: AreaSpec): AreaPattern {
  const tiles: [number, number][] = [];
  const odd = (n: number) => Math.min(21, Math.max(5, n % 2 ? n : n + 1));
  let size: number;
  let user: [number, number];
  let target: [number, number] | null = null;
  const add = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < size && y < size && !tiles.some(t => t[0] === x && t[1] === y)) tiles.push([x, y]); };
  if (spec.kind === 'self') {
    const r = Math.min(9, squares(spec.r)); size = odd(2 * r + 3); const c = (size - 1) / 2; user = [c, c];
    for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if ((x !== c || y !== c) && Math.hypot(x - c, y - c) <= r + 0.4) add(x, y);
  } else if (spec.kind === 'line' || spec.kind === 'cone') {
    const l = Math.min(10, squares(spec.len)); size = odd(2 * l + 1); const c = (size - 1) / 2; user = [c, c];
    if (spec.kind === 'line') { const w = spec.half ?? 0; for (let y = c - l; y < c; y++) for (let x = c - w; x <= c + w; x++) add(x, y); }
    else for (let x = 0; x < size; x++) for (let y = 0; y < c; y++) {
      const dx = x - c; const dy = c - y; const dist = Math.hypot(dx, dy);
      if (dist <= l + 0.4 && (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI <= spec.deg + 0.01) add(x, y);
    }
  } else {
    const reach = spec.kind === 'target' ? squares(spec.r) : spec.kind === 'wall' ? Math.floor(squares(spec.len) / 2) : spec.arm;
    const d = Math.max(1, Math.min(squares(spec.range), 10 - reach)); size = odd(2 * (d + reach) + 1); const c = (size - 1) / 2; user = [c, c]; target = [c, c - d];
    const [tx, ty] = target;
    if (spec.kind === 'target') { for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if (Math.hypot(x - tx, y - ty) <= reach + 0.4) add(x, y); }
    else if (spec.kind === 'wall') for (let x = tx - reach; x <= tx + reach; x++) add(x, ty);
    else { add(tx, ty); for (let i = 1; i <= reach; i++) { add(tx - i, ty - i); add(tx + i, ty - i); add(tx - i, ty + i); add(tx + i, ty + i); } }
  }
  return { size: size!, user: user!, target, tiles };
}

// ---------- relleno sin pisar ----------
const TYPE_ALIAS: Record<string, string> = { fisico: 'physical', físico: 'physical', magico: 'magic', mágico: 'magic' };
const norm = (v: unknown) => JSON.stringify(v, (_k, x) => {
  if (typeof x === 'string') return TYPE_ALIAS[x.toLowerCase()] ?? x;
  if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)));
  return x;
});
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const brief = (v: unknown) => { const s = JSON.stringify(v); return s.length > 90 ? `${s.slice(0, 87)}…` : s; };

type Report = { set: string[]; conflicts: string[]; manual: string[] };

function fill(target: Record<string, unknown>, wanted: Record<string, unknown>, label: string, rep: Report) {
  for (const [key, value] of Object.entries(wanted)) {
    if (value === undefined) continue;
    const have = target[key];
    if (empty(have)) { target[key] = value; rep.set.push(`${label}${key}`); continue; }
    if (key === 'damage' && typeof have === 'object' && have && !Array.isArray(have)) {
      fill(have as Record<string, unknown>, value as Record<string, unknown>, `${label}damage.`, rep);
      continue;
    }
    if (norm(have) !== norm(value)) rep.conflicts.push(`${label}${key}: suyo ${brief(have)} · wiki ${brief(value)}`);
  }
}

function wanted(cfg: Cfg | VariantCfg, slot: Slot, champ: ChampCfg, isNew: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cfg.desc) out.description = cfg.desc;
  if (cfg.dmg) out.damage = damage(cfg.dmg, slot);
  if (cfg.fx) out.effect = effects(cfg.fx);
  if (cfg.enemy) { out.effectTarget = 'enemy'; out.effectName = cfg.enemy.name; out.effectDuration = turns(cfg.enemy.sec); }
  if ('cost' in cfg || 'cd' in cfg || 'area' in cfg || 'stacks' in cfg || 'onHit' in cfg || 'selfSec' in cfg || 'resource' in cfg) {
    const c = cfg as Cfg;
    if (c.cost) out.cost = costText(c.cost);
    if (c.resource) out.resource = c.resource;
    else if (c.cost) out.resource = champ.resource;
    else if (isNew && slot !== 'P') out.resource = 'ninguno';
    if (c.cd) out.cooldown = turns(middle(c.cd));
    if (c.selfSec !== undefined && !c.enemy) out.effectDuration = turns(c.selfSec);
    if (c.area) out.area = area(c.area);
    if (c.stacks) { out.hasStacks = true; out.maxStacks = c.stacks; }
    if (c.onHit) out.appliesOnHit = true;
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const db = await getDb();
  const col = db.collection<{ _id: ObjectId; champion: string; abilities?: Record<string, ChampionAbility> }>('champions');
  const updates: { champion: string; id: ObjectId; slots: Record<string, ChampionAbility> }[] = [];
  const lines: string[] = [];
  for (const [name, champ] of Object.entries(DATA)) {
    const doc = await col.findOne({ champion: name });
    if (!doc) { lines.push(`## ${name}: NO EXISTE en la BD`); continue; }
    const rep: Report = { set: [], conflicts: [], manual: [] };
    const changed: Record<string, ChampionAbility> = {};
    for (const slot of ['P', 'Q', 'W', 'E', 'R'] as Slot[]) {
      const existing = doc.abilities?.[slot];
      if (champ.skip?.[slot]) { rep.conflicts.push(`${slot}: ${champ.skip[slot]}`); continue; }
      const cfg = champ.slots[slot];
      if (!cfg) continue;
      for (const m of cfg.manual ?? []) rep.manual.push(`${slot}: ${m}`);
      const isNew = !existing;
      const ability = (existing ? structuredClone(existing) : { name: cfg.name, learned: false }) as unknown as Record<string, unknown>;
      const before = JSON.stringify(ability);
      const local: Report = { set: [], conflicts: [], manual: [] };
      fill(ability, wanted(cfg, slot, champ, isNew), '', local);
      if (cfg.variants) {
        const variants = (ability.variants ?? []) as ChampionAbilityVariant[];
        for (const v of cfg.variants) {
          const found = variants.find(x => x.name?.trim().toLowerCase() === v.name.toLowerCase());
          if (!found) { local.conflicts.push(`variante «${v.name}» no existe: no se crea`); continue; }
          fill(found as unknown as Record<string, unknown>, wanted(v, slot, champ, false), `«${v.name}».`, local);
        }
      }
      if (isNew) rep.set.push(`${slot} creada «${cfg.name}»: ${local.set.join(', ') || '—'}`);
      else if (local.set.length) rep.set.push(`${slot} «${existing!.name}»: ${local.set.join(', ')}`);
      for (const c of local.conflicts) rep.conflicts.push(`${slot}: ${c}`);
      if (JSON.stringify(ability) !== before || isNew) {
        const parsed = parseChampionAbilityPatch({ slot, ability });
        if (norm(parsed.ability) !== norm(ability)) rep.conflicts.push(`${slot}: la validación cambiaría campos; NO se escribe`);
        else changed[slot] = ability as unknown as ChampionAbility;
      }
    }
    for (const note of NAME_NOTES[name] ?? []) rep.conflicts.push(note);
    lines.push(`## ${name}`, ` Puesto: ${rep.set.join(' | ') || 'nada'}`, ` Conflictos: ${rep.conflicts.join(' | ') || 'ninguno'}`, ` A mano: ${rep.manual.join(' | ') || '—'}`);
    if (Object.keys(changed).length) updates.push({ champion: name, id: doc._id, slots: changed });
  }
  console.log(lines.join('\n'));
  if (dry) { console.log(`\n[dry] ${updates.length} campeones con cambios; nada escrito`); process.exit(0); }
  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-champion-abilities`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  writeFileSync(join(dir, 'changes.json'), JSON.stringify(updates, null, 2), 'utf8');
  writeFileSync(join(dir, 'report.txt'), lines.join('\n'), 'utf8');
  console.log(`\nCopia: ${dir} (${all.length} campeones)`);
  const now = new Date().toISOString();
  for (const u of updates) {
    const $set: Record<string, unknown> = { updatedAt: now };
    for (const [slot, ability] of Object.entries(u.slots)) $set[`abilities.${slot as ChampionSlot}`] = ability;
    await col.updateOne({ _id: u.id }, { $set });
    console.log(`escrito ${u.champion}: ${Object.keys(u.slots).join(', ')}`);
  }
  process.exit(0);
}

const NAME_NOTES: Record<string, string[]> = {
  Karthus: [
    'Nombres: su P «Requiem» es Death Defied; su W «Maldicion de los Muertos» (coste 35 = Wall of Pain); su E «Muro de Dolor» (coste = Defile). Rellenado por hueco, nombres sin tocar',
  ],
};

main().catch(error => { console.error(error); process.exit(1); });
