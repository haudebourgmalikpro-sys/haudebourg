// Shared Haudebourg account + orders store — persists in localStorage, syncs across pages & tabs.
const AKEY = 'haudebourg_account_v1';
const OKEY = 'haudebourg_orders_v1';
const NKEY = 'haudebourg_order_seq_v1';

const STATUSES = ['Confirmée', 'En préparation', 'Expédiée', 'Livrée'];

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}

let user = loadJSON(AKEY, null);       // { email, firstName, lastName, address, zip, city, country }
let orders = loadJSON(OKEY, []);        // [{ no, date, items, sub, total, status, email }]
let seq = loadJSON(NKEY, 204815);       // last used sequential order number

const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
function track(name, props) { try { if (typeof window !== 'undefined' && window.plausible) window.plausible(name, props ? { props } : undefined); } catch (e) {} }
function persistUser() { try { localStorage.setItem(AKEY, JSON.stringify(user)); } catch (e) {} emit(); }
function persistOrders() { try { localStorage.setItem(OKEY, JSON.stringify(orders)); } catch (e) {} emit(); }
function persistSeq() { try { localStorage.setItem(NKEY, JSON.stringify(seq)); } catch (e) {} }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === AKEY) { user = loadJSON(AKEY, null); emit(); }
    if (e.key === OKEY) { orders = loadJSON(OKEY, []); emit(); }
    if (e.key === NKEY) { seq = loadJSON(NKEY, seq); }
  });
}

export const ACCOUNT = {
  user() { return user; },
  isLoggedIn() { return !!user; },
  initial() { return user ? (user.firstName || user.email || '?').trim().charAt(0).toUpperCase() : ''; },

  // Demo auth: no real password checks — stored locally only.
  signup(data) {
    user = {
      email: (data.email || '').trim(),
      firstName: (data.firstName || '').trim(),
      lastName: (data.lastName || '').trim(),
      address: (data.address || '').trim(),
      zip: (data.zip || '').trim(),
      city: (data.city || '').trim(),
      country: (data.country || 'France').trim(),
      createdAt: Date.now()
    };
    persistUser();
    track('Compte créé');
    return user;
  },
  login(email) {
    if (!user || user.email !== (email || '').trim()) {
      // No prior account in this demo → create a light profile from the email.
      user = { email: (email || '').trim(), firstName: '', lastName: '', address: '', zip: '', city: '', country: 'France', createdAt: Date.now() };
    }
    persistUser();
    return user;
  },
  update(patch) { if (!user) return; user = { ...user, ...patch }; persistUser(); },
  logout() { user = null; persistUser(); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
};

export const ORDERS = {
  all() { return orders.slice(); },
  forUser() { return user ? orders.filter(o => o.email === user.email) : orders.slice(); },
  // Unique, ever-increasing order number — a new one every time.
  nextNo() { seq += 1; persistSeq(); return 'HB-' + seq; },
  add(order) {
    const o = { status: 'Confirmée', date: Date.now(), no: ('HB-' + (seq + 1)), ...order };
    if (!order.no) { seq += 1; persistSeq(); o.no = 'HB-' + seq; }
    orders = [o, ...orders];
    persistOrders();
    track('Achat', { montant: Math.round((o.total || 0) * 100) / 100, commande: o.no });
    return o;
  },
  setStatus(no, status) {
    if (STATUSES.indexOf(status) < 0) return;
    orders = orders.map(o => o.no === no ? { ...o, status } : o);
    persistOrders();
  },
  // Toggle the "shipped" state of an order (Expédiée ↔ En préparation).
  toggleShipped(no) {
    orders = orders.map(o => {
      if (o.no !== no) return o;
      return { ...o, status: o.status === 'Expédiée' || o.status === 'Livrée' ? 'En préparation' : 'Expédiée' };
    });
    persistOrders();
  },
  statuses() { return STATUSES.slice(); },
  statusIndex(s) { const i = STATUSES.indexOf(s); return i < 0 ? 0 : i; }
};

export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
}
