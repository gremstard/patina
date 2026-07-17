// The item catalogue and per-shop stock. Deterministic: a given shop always
// sells the same things (its interior seed picks the subset), so streaming a
// city out and back doesn't reshuffle the shelves.

import { hash } from '../core/hash.js';

// id → { name, price }. Prices are whole dollars. A few of these (crowbar,
// flashlight) are tools the later crime loop will use; the rest are flavour /
// money sinks for now.
export const ITEMS = {
  water: { name: 'Water', price: 1 },
  cola: { name: 'Cola', price: 2 },
  chips: { name: 'Chips', price: 3 },
  energy: { name: 'Energy bar', price: 3 },
  coffee: { name: 'Coffee', price: 4 },
  sandwich: { name: 'Sandwich', price: 6 },
  citymap: { name: 'Folding map', price: 5 },
  lighter: { name: 'Lighter', price: 2 },
  cigs: { name: 'Cigarettes', price: 9 },
  cap: { name: 'Ball cap', price: 11 },
  charger: { name: 'Phone charger', price: 12 },
  tshirt: { name: 'T-shirt', price: 15 },
  flashlight: { name: 'Flashlight', price: 14 },
  medkit: { name: 'First-aid kit', price: 22 },
  crowbar: { name: 'Crowbar', price: 35 },
};

const POOL = Object.keys(ITEMS);

// A shop's stock: a deterministic 6–8 item subset, seeded by the interior.
export function shopStock(seed) {
  seed = seed >>> 0;
  const ids = POOL.slice();
  for (let i = ids.length - 1; i > 0; i--) {
    const j = hash(seed, i) % (i + 1);
    const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  }
  const n = 6 + (hash(seed, 'n') % 3);
  return ids.slice(0, n).map((id) => ({ id, name: ITEMS[id].name, price: ITEMS[id].price }));
}
