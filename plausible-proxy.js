/*
 * Haudebourg — Proxy Plausible (Cloudflare Worker)
 * ------------------------------------------------
 * Appelle l'API Plausible côté SERVEUR (la clé reste secrète) et renvoie au
 * tableau de bord uniquement des chiffres RÉELS, avec les en-têtes CORS requis.
 *
 * ▶ DÉPLOIEMENT (≈ 5 min, gratuit)
 *   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker.
 *   2. Colle CE fichier, « Deploy ».
 *   3. Settings → Variables (chiffrées / "Encrypt") :
 *        PLAUSIBLE_API_KEY = ta_nouvelle_clé   (⚠️ régénère-la d'abord)
 *        SITE_ID           = ton domaine déclaré dans Plausible (ex. haudebourg.fr)
 *        ALLOW_ORIGIN      = l'adresse de ton site (ex. https://haudebourg.fr) — optionnel, défaut "*"
 *   4. Copie l'URL du Worker et colle-la dans le tableau de bord (PROXY_URL).
 *
 * Les NOMS d'événements doivent correspondre à ceux envoyés par le site :
 *   « Panier créé », « Compte créé », « Abonnement », « Achat ».
 * Le chiffre d'affaires réel nécessite « Achat » configuré comme objectif à revenu ;
 * sinon il est estimé (commandes × panier moyen) et marqué comme tel.
 */

const API = 'https://plausible.io/api/v2/query';
const GOALS = { carts: 'Panier créé', accounts: 'Compte créé', subs: 'Abonnement', orders: 'Achat' };
const AVG_BASKET = 22;

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.PLAUSIBLE_API_KEY || !env.SITE_ID) {
      return json({ error: 'Configurez PLAUSIBLE_API_KEY et SITE_ID dans les variables du Worker.' }, 500, cors);
    }

    const period = new URL(request.url).searchParams.get('period') || 'today';
    const range = period === '7d' ? '7d' : period === '30d' ? '30d' : 'day';
    const bucket = range === 'day' ? 'time:hour' : 'time:day';

    const q = (body) => fetch(API, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.PLAUSIBLE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ site_id: env.SITE_ID, date_range: range }, body))
    }).then(r => r.json()).catch(() => null);

    const breakdown = async (dim, metric) => {
      const r = await q({ metrics: [metric || 'visitors'], dimensions: [dim], order_by: [[metric || 'visitors', 'desc']], pagination: { limit: 6 } });
      if (!r || !r.results) return [];
      return r.results.map(row => ({ name: (row.dimensions[0] || '(direct)'), value: row.metrics[0] || 0 }));
    };

    try {
      // Audience agrégée
      const agg = await q({ metrics: ['visitors', 'pageviews', 'visit_duration', 'bounce_rate'] });
      const a = (agg && agg.results && agg.results[0]) ? agg.results[0].metrics : [0, 0, 0, 0];
      const visitors = a[0] || 0, pageviews = a[1] || 0, durationSec = a[2] || 0, bounce = a[3] || 0;

      // Événements personnalisés
      const names = Object.values(GOALS);
      const ev = await q({ metrics: ['events'], dimensions: ['event:name'], filters: [['is', 'event:name', names]] });
      const counts = {};
      if (ev && ev.results) for (const row of ev.results) counts[row.dimensions[0]] = row.metrics[0] || 0;
      const carts = counts[GOALS.carts] || 0, accounts = counts[GOALS.accounts] || 0;
      const subs = counts[GOALS.subs] || 0, orders = counts[GOALS.orders] || 0;

      // Chiffre d'affaires (réel si objectif à revenu, sinon estimé)
      let sales = orders * AVG_BASKET, revenueConfigured = false;
      const rev = await q({ metrics: ['total_revenue'], filters: [['is', 'event:name', [GOALS.orders]]] });
      const revRow = rev && rev.results && rev.results[0];
      if (revRow && typeof revRow.metrics[0] === 'number' && revRow.metrics[0] > 0) { sales = revRow.metrics[0]; revenueConfigured = true; }

      // Série temporelle des achats
      const ts = await q({ metrics: ['events'], dimensions: [bucket], filters: [['is', 'event:name', [GOALS.orders]]] });
      let series = (ts && ts.results) ? ts.results.map(r => ({ label: shortLabel(r.dimensions[0], range), value: r.metrics[0] || 0 })) : [];
      if (!series.length) series = [{ label: '', value: 0 }];

      // Répartitions réelles
      const [sources, pages, devices] = await Promise.all([
        breakdown('visit:source', 'visitors'),
        breakdown('event:page', 'pageviews'),
        breakdown('visit:device', 'visitors')
      ]);

      return json({
        period, connected: true,
        kpis: { visitors, pageviews, bounce, carts, accounts, subs, orders, sales, revenueConfigured },
        avg: formatDuration(durationSec),
        series, sources, pages, devices
      }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
}
function formatDuration(sec) {
  sec = Math.round(sec || 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? (m + ' min ' + String(s).padStart(2, '0') + ' s') : (s + ' s');
}
function shortLabel(v, range) {
  if (!v) return '';
  if (range === 'day') { const m = String(v).match(/(\d{2}):/); return m ? m[1] + 'h' : String(v).slice(-5); }
  const m = String(v).match(/\d{4}-(\d{2})-(\d{2})/); return m ? (m[3] + '/' + m[2]) : String(v);
}
