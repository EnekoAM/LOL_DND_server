/**
 * Actualiza nombres oficiales es-ES (Data Dragon) y descripciónes de las mecánicas ya configuradas.
 * No toca costes, daño, áreas ni mechanics.
 *   npx tsx scripts/set-ability-names-es.ts --dry
 *   npx tsx scripts/set-ability-names-es.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObjectId } from 'mongodb';
import { getDb } from '../src/db';

type Slot = 'P' | 'Q' | 'W' | 'E' | 'R';
type AbilityText = { name: string; description: string };
type Payload = Record<string, Partial<Record<Slot, AbilityText>>>;
type ChampDoc = { _id: ObjectId; champion: string; abilities?: Record<string, Record<string, unknown>> };

const SLOTS: Slot[] = ['P', 'Q', 'W', 'E', 'R'];
const here = dirname(fileURLToPath(import.meta.url));

function withoutText(ability: Record<string, unknown> | undefined): string {
  if (!ability) return '';
  const { name: _n, description: _d, ...rest } = ability;
  return JSON.stringify(rest);
}

async function main() {
  const dry = process.argv.includes('--dry');
  const payload = JSON.parse(readFileSync(join(here, 'ability-names-es.json'), 'utf8')) as Payload;
  const db = await getDb();
  const col = db.collection<ChampDoc>('champions');

  const lines: string[] = [];
  let nameCount = 0;
  let descCount = 0;
  const writes: { id: ObjectId; champion: string; set: Record<string, unknown> }[] = [];

  for (const [champion, slots] of Object.entries(payload)) {
    const doc = await col.findOne({ champion });
    if (!doc) throw new Error(`${champion} no está en la base`);
    const set: Record<string, unknown> = {};
    for (const slot of SLOTS) {
      const wanted = slots[slot];
      if (!wanted) continue;
      const have = (doc.abilities?.[slot] ?? {}) as Record<string, unknown>;
      const oldName = typeof have.name === 'string' ? have.name : '';
      const oldDesc = typeof have.description === 'string' ? have.description : '';
      if (oldName !== wanted.name) {
        set[`abilities.${slot}.name`] = wanted.name;
        nameCount += 1;
        lines.push(`${champion} ${slot} nombre: ${JSON.stringify(oldName)} -> ${JSON.stringify(wanted.name)}`);
      }
      if (oldDesc !== wanted.description) {
        set[`abilities.${slot}.description`] = wanted.description;
        descCount += 1;
        lines.push(`${champion} ${slot} descripción actualizada (${oldDesc.length} -> ${wanted.description.length} chars)`);
      }
    }
    if (Object.keys(set).length) writes.push({ id: doc._id, champion, set });
  }

  console.log(lines.join('\n'));
  console.log(`NOMBRES ${nameCount}  DESCRIPCIONES ${descCount}  CAMPEONES ${writes.length}`);
  if (dry) { console.log('[dry] nada escrito'); process.exit(0); }

  const dir = join(process.cwd(), 'backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-ability-names-es`);
  mkdirSync(dir, { recursive: true });
  const all = await col.find({}).toArray();
  writeFileSync(join(dir, 'champions.json'), JSON.stringify(all, null, 2), 'utf8');
  console.log(`Copia: ${dir} (${all.length} campeones)`);

  for (const write of writes) {
    const before = await col.findOne({ _id: write.id });
    const snap: Record<string, string> = {};
    for (const slot of SLOTS) snap[slot] = withoutText(before?.abilities?.[slot]);
    await col.updateOne({ _id: write.id }, { $set: write.set });
    const after = await col.findOne({ _id: write.id });
    for (const slot of SLOTS) {
      const prev = snap[slot];
      const next = withoutText(after?.abilities?.[slot]);
      if (prev !== next) throw new Error(`${write.champion} ${slot}: se ha alterado la configuración (name/description aparte)`);
    }
  }
  console.log('Comprobado: costes, daño, áreas y mechanics no han cambiado');
  process.exit(0);
}

main().catch(error => { console.error(error); process.exit(1); });
