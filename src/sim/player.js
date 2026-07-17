// The player's economy: a wallet and an inventory. Plain data plus small pure
// helpers — the app owns persistence (localStorage) and the HUD. This is the
// foundation the jobs / buying / robbing loops all build on.
//
// items is a map keyed by a stable item id → { name, value, qty }. Money is a
// whole-dollar integer (no cents — arcade).

const MAX_STACK = 999;

export const START_MONEY = 40;

// A couple of things everyone starts with, so the inventory isn't empty on day
// one and the panel reads as real.
const STARTER = [
  ['phone', 'Cellphone', 0],
  ['keys', 'House keys', 0],
];

export function createPlayer() {
  const p = { money: START_MONEY, items: {}, home: null };
  for (const [id, name, value] of STARTER) addItem(p, id, name, value, 1);
  return p;
}

export function addMoney(p, amt) {
  p.money = Math.max(0, Math.round(p.money + amt));
  return p.money;
}

// Try to spend `amt`; returns true and deducts if affordable, else false.
export function spend(p, amt) {
  if (amt < 0 || p.money < amt) return false;
  p.money -= Math.round(amt);
  return true;
}

export function addItem(p, id, name, value = 0, qty = 1) {
  const it = p.items[id] || (p.items[id] = { name, value, qty: 0 });
  it.name = name; it.value = value;
  it.qty = Math.min(MAX_STACK, it.qty + qty);
  return it;
}

export function removeItem(p, id, qty = 1) {
  const it = p.items[id];
  if (!it || it.qty < qty) return false;
  it.qty -= qty;
  if (it.qty <= 0) delete p.items[id];
  return true;
}

export function countItem(p, id) {
  const it = p.items[id];
  return it ? it.qty : 0;
}

// Inventory as a stable, display-ready array (sorted by name).
export function itemList(p) {
  return Object.entries(p.items)
    .map(([id, it]) => ({ id, name: it.name, value: it.value, qty: it.qty }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

// ── persistence ──────────────────────────────────────────────────────────────
const KEY = 'patina.player.v1';

export function savePlayer(p, storage) {
  try { (storage || globalThis.localStorage).setItem(KEY, JSON.stringify({ money: p.money, items: p.items, home: p.home })); } catch { /* ignore */ }
}

export function loadPlayer(storage) {
  try {
    const raw = (storage || globalThis.localStorage).getItem(KEY);
    if (!raw) return createPlayer();
    const d = JSON.parse(raw);
    if (typeof d.money !== 'number' || typeof d.items !== 'object' || !d.items) return createPlayer();
    return { money: Math.max(0, Math.round(d.money)), items: d.items, home: d.home || null };
  } catch {
    return createPlayer();
  }
}
