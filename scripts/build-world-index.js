// §4 — The build-time world index, offline.
//
// "Run the settlement generator once, offline. Ship the result as a ~40–100 KB
// blob: every settlement's position, tier, name, culture, road-anchor list."
//
// Usage:
//   npm run worldindex           # default seed
//   npm run worldindex -- 8829   # explicit seed
//
// Writes data/world-index.<seed>.json and prints a summary + digest. The digest
// it prints is the value that belongs in the determinism test (§5 check #3).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateWorldIndex, counts, digest } from '../src/worldgen/worldIndex.js';

const seed = (process.argv[2] ? Number(process.argv[2]) : 8829) >>> 0;

const idx = generateWorldIndex(seed);
const c = counts(idx);
const d = digest(idx);

// The shipped blob stores only non-derivable fields. rx/rz (region) and palette
// are pure functions of x/z and culture respectively, so the loader recomputes
// them — that keeps the artifact inside the §4 ~40–100 KB budget. The rich
// in-memory object (with rx/rz/palette) is what the digest is pinned against, so
// slimming the disk format never touches determinism.
const slim = {
  seed: idx.seed,
  digest: d,
  // columnar-ish: keep it a list of small objects, drop derivable keys
  settlements: idx.settlements.map((s) =>
    s.name === null
      ? { id: s.id, tier: s.tier, x: s.x, z: s.z, culture: s.culture }
      : { id: s.id, tier: s.tier, x: s.x, z: s.z, culture: s.culture, name: s.name },
  ),
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'data', `world-index.${seed}.json`);
const json = JSON.stringify(slim);
writeFileSync(outPath, json);

const kb = (json.length / 1024).toFixed(1);
console.log(`world index for seed ${seed}`);
console.log(`  settlements : ${idx.settlements.length}`);
console.log(`  metros      : ${c.metros}`);
console.log(`  cities      : ${c.cities}`);
console.log(`  towns       : ${c.towns}`);
console.log(`  hamlets     : ${c.hamlets}`);
console.log(`  digest      : ${d}   (pin this in the determinism test)`);
console.log(`  size        : ${kb} KB   (§4 budget: ~40–100 KB)`);
console.log(`  written     : ${outPath}`);
