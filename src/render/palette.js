// §9 / §3 — The building palette, bound to naming culture.
//
// "Bind the building palette variant to the same noise field. Red brick
//  northeast, orange plaster southwest. One line, and cities look like they come
//  from somewhere." Each culture's `palette` key (from names.js) selects a small
//  PSX-limited set of wall colours; per-building variation comes from the hash,
//  never Math.random.
//
// Colours are [r,g,b] in 0..1 for vertex colours (§10 MeshLambertMaterial).

const hex = (h) => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];

// Wall-colour ramps per culture palette variant. 3–4 muted tones each; the
// generator picks one by hash and the lambert light does the rest.
export const WALLS = {
  redbrick: [0x8c4a3a, 0x9d5646, 0x743b30, 0xa56250].map(hex), // Anglic — rust belt / New England
  orangeplaster: [0xc98a4e, 0xb97a42, 0xd69b5c, 0xa96f3e].map(hex), // Iberic — southwest
  greyconcrete: [0x8a8f92, 0x767b7e, 0x9aa0a2, 0x6c7174].map(hex), // Rustbelt — industrial
  palebrick: [0xb4a986, 0xc4b998, 0xa39877, 0xcabf9f].map(hex), // Conlang — old-country
};

// Roofs, slightly darker/desaturated than walls — reads as a separate material.
export const ROOFS = {
  redbrick: [0x5a3128, 0x4a2820].map(hex),
  orangeplaster: [0x7a4a2c, 0x8a5636].map(hex),
  greyconcrete: [0x4c5052, 0x5a5e60].map(hex),
  palebrick: [0x6a5f48, 0x776b52].map(hex),
};

// Surfaces shared across cultures. PSX-dark so the fog and lamps read later.
export const SURFACE = {
  asphalt: hex(0x1c2124),
  sidewalk: hex(0x8b9299), // light concrete — reads clearly as a sidewalk
  ground: hex(0x2a241c), // dusty dirt around the city — blends into the fog, not a green sheet
  parapet: hex(0x2a2d30),
  window: hex(0x161d24),
  door: hex(0x241a12),
  foliage: hex(0x3f5a39),
  trunk: hex(0x4a3a2c),
  pole: hex(0x2e3234),
};

// Pick a wall / roof colour deterministically from a culture + a hash value.
export const wall = (paletteKey, h) => {
  const ramp = WALLS[paletteKey] || WALLS.greyconcrete;
  return ramp[h % ramp.length];
};
export const roof = (paletteKey, h) => {
  const ramp = ROOFS[paletteKey] || ROOFS.greyconcrete;
  return ramp[h % ramp.length];
};

// Multiply a colour (cheap per-building shade variation without new palette
// entries). f ~ 0.85..1.1.
export const shade = (c, f) => [
  Math.min(1, c[0] * f),
  Math.min(1, c[1] * f),
  Math.min(1, c[2] * f),
];
