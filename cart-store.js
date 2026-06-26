// Shared Haudebourg cart store — persists in localStorage, syncs across pages & tabs.
const KEY = 'haudebourg_cart_v2';

export const CATALOG = {
  bordeaux: {
    id: 'bordeaux', name: 'Original', edition: 'Original',
    sub: 'L’édition signature', img: 'assets/product-bordeaux.jpg',
    price: 14.90, intensity: 4,
    tagline: 'Profonde, ronde, intemporelle.',
    notes: ['Cacao intense', 'Noisette torréfiée', 'Vanille bourbon'],
    desc: 'Notre assemblage signature, torréfié lentement en petites séries : une tasse dense, une longueur de cacao noir, de noisette torréfiée et de vanille bourbon.'
  }
};

export const GIFT_PRICE = 8;
export const GIFT_THRESHOLD = 3;
export const FREE_SHIP = 40;
export const SHIP_COST = 4.9;
export const SUB_DISCOUNT = 0.15;

export function eur(n) {
  const r = Math.round(n * 100) / 100;
  return (Number.isInteger(r) ? r.toString() : r.toFixed(2).replace('.', ',')) + ' €';
}

const listeners = new Set();
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) {
      return {
        items: s.items.filter(i => CATALOG[i.id]).map(i => ({ id: i.id, qty: Math.max(1, Math.min(9, i.qty | 0)) })),
        gift: !!s.gift,
        subscribe: !!s.subscribe
      };
    }
  } catch (e) {}
  // Seed a small default cart on first visit so the experience isn't empty.
  return { items: [{ id: 'bordeaux', qty: 2 }], gift: false, subscribe: false };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  emit();
}
function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) {} }); }
function track(name, props) { try { if (typeof window !== 'undefined' && window.plausible) window.plausible(name, props ? { props } : undefined); } catch (e) {} }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); emit(); } });
}

function q(id) { const f = state.items.find(i => i.id === id); return f ? f.qty : 0; }

export const CART = {
  state() { return state; },
  items() { return state.items.slice(); },
  count() { return state.items.reduce((a, i) => a + i.qty, 0); },
  add(id, qty = 1) {
    if (!CATALOG[id]) return;
    const wasEmpty = state.items.length === 0;
    const f = state.items.find(i => i.id === id);
    if (f) f.qty = Math.min(9, f.qty + qty);
    else state.items.push({ id, qty: Math.min(9, Math.max(1, qty)) });
    persist();
    if (wasEmpty) track('Panier créé');
  },
  setQty(id, qty) {
    const f = state.items.find(i => i.id === id);
    if (f) { f.qty = qty; if (f.qty <= 0) state.items = state.items.filter(i => i.id !== id); }
    persist();
  },
  inc(id) { this.setQty(id, Math.min(9, q(id) + 1)); },
  dec(id) { this.setQty(id, q(id) - 1); },
  remove(id) { state.items = state.items.filter(i => i.id !== id); persist(); },
  toggleGift() { state.gift = !state.gift; persist(); },
  setGift(v) { state.gift = !!v; persist(); },
  toggleSubscribe() { state.subscribe = !state.subscribe; persist(); if (state.subscribe) track('Abonnement'); },
  setSubscribe(v) { const was = state.subscribe; state.subscribe = !!v; persist(); if (state.subscribe && !was) track('Abonnement'); },
  clear() { state = { items: [], gift: false, subscribe: false }; persist(); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  catalog: CATALOG,
  totals() {
    const count = state.items.reduce((a, i) => a + i.qty, 0);
    const sub = state.items.reduce((a, i) => a + (CATALOG[i.id] ? CATALOG[i.id].price : 0) * i.qty, 0);
    const discount = state.subscribe ? sub * SUB_DISCOUNT : 0;
    const empty = state.items.length === 0;
    // Coffret: free & auto-included from GIFT_THRESHOLD items, otherwise an optional paid add-on.
    const giftFree = !empty && count >= GIFT_THRESHOLD;
    const giftOn = giftFree || state.gift;
    const gift = (giftOn && !giftFree) ? GIFT_PRICE : 0;
    const goods = sub - discount + gift;
    const freeShip = sub >= FREE_SHIP || empty;
    const ship = freeShip ? 0 : SHIP_COST;
    return { count, sub, discount, gift, giftOn, giftFree, ship, freeShip, total: empty ? 0 : goods + ship };
  }
};
