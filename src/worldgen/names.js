// §9 — Naming. A flat dictionary + random picks gives "Grand Falls, New Falls,
// Falls City" — mush. What sells a map is REGIONAL COHERENCE: each region gets a
// culture from low-frequency noise (field.cultureIndex → contiguous blobs), then
// a per-culture grammar runs.
//
// ⚠️ ASCII ONLY in name tables. A previous version shipped a .replace() across
// three writing systems that could never fire and rendered "Portराvenburg".
// asciiLint() below fails loudly if any non-ASCII sneaks in.
//
// Determinism (§5): every pick is hash(seed, i). Never Math.random().

import { hash } from '../core/hash.js';

const pick = (arr, seed, salt) => arr[hash(seed, salt) % arr.length];
const chance = (seed, salt, p) => hash(seed, salt) / 0x100000000 < p;

// ── Grammars ─────────────────────────────────────────────────────────────────
// Each culture is: how the parts combine, plus the parts. ASCII only.

const ANGLIC = {
  key: 'anglic',
  prefixes: ['New', 'Port', 'Fort', 'Mount', 'East'],
  roots: ['Rust', 'Ash', 'Iron', 'Bragg', 'Hale', 'Crest', 'Marsh', 'Thorn', 'Weald', 'Bram', 'Fenn', 'Holt', 'Wick', 'Gore', 'Barrow'],
  suffixes: ['ton', 'burg', 'ford', 'haven'],
  palette: 'redbrick', // §9: bind building palette to culture
};

const IBERIC = {
  key: 'iberic',
  prefixes: ['Santa', 'San', 'Rio', 'Los', 'Puerto'],
  roots: ['Verd', 'Sol', 'Mar', 'Cruz', 'Vist', 'Camp', 'Loma', 'Piedr', 'Robl', 'Fuent', 'Cerr', 'Llan', 'Bland', 'Sierr'],
  suffixes: ['a', 'os', 'ada', 'ero'],
  palette: 'orangeplaster',
};

const RUSTBELT = {
  key: 'rustbelt',
  prefixes: ['Old', 'North', 'Lower'],
  roots: ['Steel', 'Coke', 'Slag', 'Forge', 'Mill', 'Foundry', 'Cinder', 'Ash', 'Coal', 'Ore', 'Kiln', 'Anvil', 'Furnace', 'Rail'],
  suffixes: ['Works', 'Yard', 'Junction', 'Flats'],
  palette: 'greyconcrete',
};

// Conlang: strict CV, 2–3 syllables, NO dictionary at all. Swap the onset/vowel
// subset per region for phonotactic drift — different regions sound like
// different peoples, from no word list (§9).
const CONLANG = {
  key: 'conlang',
  onsets: ['t', 'k', 'm', 'n', 's', 'r', 'l', 'p', 'b', 'd', 'g', 'v', 'h', 'z'],
  vowels: ['a', 'e', 'i', 'o', 'u'],
  palette: 'palebrick',
};

export const CULTURES = [ANGLIC, IBERIC, RUSTBELT, CONLANG];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function anglic(seed) {
  const root = pick(ANGLIC.roots, seed, 1);
  const suf = pick(ANGLIC.suffixes, seed, 2);
  const base = root + suf;
  return chance(seed, 3, 0.5) ? `${pick(ANGLIC.prefixes, seed, 4)} ${base}` : base;
}

function iberic(seed) {
  const root = pick(IBERIC.roots, seed, 1);
  const suf = pick(IBERIC.suffixes, seed, 2);
  const base = root + suf;
  return chance(seed, 3, 0.55) ? `${pick(IBERIC.prefixes, seed, 4)} ${base}` : base;
}

function rustbelt(seed) {
  const root = pick(RUSTBELT.roots, seed, 1);
  const suf = pick(RUSTBELT.suffixes, seed, 2);
  const base = `${root} ${suf}`;
  return chance(seed, 3, 0.4) ? `${pick(RUSTBELT.prefixes, seed, 4)} ${base}` : base;
}

// regionSeed selects the onset/vowel SUBSET, giving each region its own accent.
function conlang(seed, regionSeed) {
  // Per-region phonotactic drift: rotate a window into the full inventories.
  const onA = hash(regionSeed, 'onset') % CONLANG.onsets.length;
  const voA = hash(regionSeed, 'vowel') % CONLANG.vowels.length;
  const onset = (i) => CONLANG.onsets[(onA + i) % CONLANG.onsets.length];
  const vowel = (i) => CONLANG.vowels[(voA + i) % CONLANG.vowels.length];
  const syllables = 2 + (hash(seed, 'nsyl') % 2); // 2 or 3
  let out = '';
  for (let i = 0; i < syllables; i++) {
    out += onset(hash(seed, 'c', i) % CONLANG.onsets.length);
    out += vowel(hash(seed, 'v', i) % CONLANG.vowels.length);
  }
  return cap(out);
}

// Build a settlement name for a given culture object. `regionSeed` only matters
// for the conlang culture but is always accepted so callers need no special case.
export function makeName(culture, nameSeed, regionSeed) {
  switch (culture.key) {
    case 'anglic':
      return anglic(nameSeed);
    case 'iberic':
      return iberic(nameSeed);
    case 'rustbelt':
      return rustbelt(nameSeed);
    case 'conlang':
      return conlang(nameSeed, regionSeed >>> 0);
    default:
      throw new Error(`makeName: unknown culture ${culture && culture.key}`);
  }
}

// §9 — Ped names. Same generator, different grammar. Corporate mashups and
// Bob-variants. hash(pedSeed, 'name'), never Math.random().
const BOB = ['Bob', 'Bobert', 'Bobson', 'Bobandy', 'Bobrick', 'Bobbi', 'Jimbob', 'Bobette', 'Bobothy', 'Bobbins', 'Bobitha', 'Bobra', 'Boblas'];
const MASHUP = ['Jimothy', 'Billiam', 'Philbert', 'Gary', 'Marv', 'Cletus', 'Poindexter', 'Fredrick', 'Albert'];

export function pedName(pedSeed) {
  const s = hash(pedSeed, 'name');
  const base = hash(s, 'fam') % 2 ? pick(BOB, s, 1) : pick(MASHUP, s, 1);
  let name = base;
  if (chance(s, 2, 0.12)) name = `Ol' ${name}`;
  if (chance(s, 3, 0.12)) name = `${name} Jr.`;
  return name;
}

// ── Lint (§9) ────────────────────────────────────────────────────────────────
// Fail loudly if any name table contains non-ASCII. Called by the determinism
// test so a stray accented character can never ship.
export function asciiLint() {
  const nonAscii = /[^\x00-\x7F]/;
  const tables = [
    ...CULTURES.flatMap((c) => [c.prefixes, c.roots, c.suffixes, c.onsets, c.vowels].filter(Boolean).flat()),
    ...BOB,
    ...MASHUP,
  ];
  const bad = tables.filter((s) => nonAscii.test(s));
  if (bad.length) throw new Error(`asciiLint: non-ASCII in name tables: ${bad.join(', ')}`);
  return true;
}
