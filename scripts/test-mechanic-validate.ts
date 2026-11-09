/** Validación de parsePlayerPatch.mechanic (sin Mongo). Invocado por test-mechanic.cjs. */
import { parsePlayerPatch } from '../src/validate';
import { HttpError } from '../src/errors';

const FAMA_REGIONS = [
  'Demacia', 'Noxus', 'Freljord', 'Jonia', 'Piltover', 'Zaun',
  'Shurima', 'Targon', 'Bilgewater', 'Islas de la Sombra', 'Ixtal', 'Bandle',
] as const;

function fail(body: unknown, includes?: string) {
  try {
    parsePlayerPatch(body);
    throw new Error('expected throw');
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    if (includes && !e.message.includes(includes)) throw new Error(`msg=${e.message}`);
  }
}

const r = parsePlayerPatch({ mechanic: { type: 'ruina', value: 7 } });
if (!r.mechanic || r.mechanic.type !== 'ruina' || r.mechanic.value !== 7) throw new Error('ruina parse');

const h = parsePlayerPatch({ mechanic: { type: 'humanidad', value: -4 } });
if (!h.mechanic || h.mechanic.type !== 'humanidad' || h.mechanic.value !== -4) throw new Error('hum parse');

const regions: Record<string, number> = {};
for (const name of FAMA_REGIONS) regions[name] = 0;
regions.Demacia = 42;
const f = parsePlayerPatch({ mechanic: { type: 'fama', regions } });
if (!f.mechanic || f.mechanic.type !== 'fama' || f.mechanic.regions.Demacia !== 42) throw new Error('fama parse');

fail({ mechanic: { type: 'ruina', value: 0 } }, 'ruina');
fail({ mechanic: { type: 'ruina', value: 21 } }, 'ruina');
fail({ mechanic: { type: 'humanidad', value: -11 } }, 'humanidad');
fail({ mechanic: { type: 'humanidad', value: 11 } }, 'humanidad');
fail({ mechanic: { type: 'fama', regions: { Atlantis: 1 } } }, 'Región');
fail({ mechanic: { type: 'fama', regions: { Demacia: 1.5 } } }, 'entero');

const cleared = parsePlayerPatch({ mechanic: null });
if (cleared.mechanic !== null) throw new Error('null clear');

console.log('validate ok');
