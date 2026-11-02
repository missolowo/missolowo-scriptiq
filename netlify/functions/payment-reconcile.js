// ============================================
// MISSOLOWO SLATE — PAYMENT RECONCILIATION
// ============================================
// Finds money Paystack took that we never credited.
//
// WHY THIS EXISTS: the payments row is written BY payment-verify, and
// payment-verify only runs when the customer's browser comes back from
// Paystack. A filmmaker who pays and loses her connection before that
// redirect lands gets no credits AND leaves no row — so ops-metrics cannot
// see her either, because it counts rows. The only record is Paystack's
// dashboard, and nothing tells us it happened. On a Lagos mobile connection
// that is not a rare case.
//
// WHAT IT DOES NOT DO: grant credits. Not one line of this file decides
// whether a payment earns credits or how many. The repair path POSTs the
// reference to payment-verify, which already claims the row before
// crediting, checks the amount against the pricing file, refuses test-mode
// payments and is idempotent on a unique index. That logic is tested and
// live; the right change was to point at it, not to write a second copy.
// A second grant path on the money road, added during a launch freeze, is
// exactly the change most likely to go wrong.
//
// The proper fix is a Paystack webhook on charge.success, which catches
// these the moment they happen instead of whenever this is run. That means
// a new public endpoint that grants credits, where a mistake in the
// signature check mints credits for free, so it waits until after launch.
//
// Requires OPS_METRICS_KEY. Header only — x-ops-key. A key in a query
// string ends up in server logs, browser history and Referer headers, and
// this endpoint is new, so there is no bookmark to break by refusing one.
// ============================================
const fetch = (() => {
  try { return require('node-fetch'); }
  catch (e) { return global.fetch; }
})();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

// Paystack pages its transaction list. 100 is its maximum per page.
const PER_PAGE = 100;
const MAX_PAGES = 10;

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// Every successful LIVE transaction in the window, oldest page first.
// Test-mode transactions are left out here as well as being refused
// downstream: a preview build's test purchase is not missing money.
async function paystackSuccesses(secret, fromDate) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = 'https://api.paystack.co/transaction'
      + '?status=success&perPage=' + PER_PAGE + '&page=' + page
      + '&from=' + encodeURIComponent(fromDate);
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + secret } });
    const body = await res.json();
    if (!body || !body.status || !Array.isArray(body.data)) {
      throw new Error((body && body.message) || 'Paystack transaction list failed');
    }
    body.data.forEach(function (t) {
      if (t.domain && t.domain !== 'live') return;
      out.push({
        reference: t.reference,
        amount: t.amount,
        currency: t.currency,
        paid_at: t.paid_at || t.transaction_date,
        email: (t.customer && t.customer.email) || null,
        pack: (t.metadata && (t.metadata.pack || t.metadata.plan)) || null
      });
    });
    if (body.data.length < PER_PAGE) break;
  }
  return out;
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: Object.assign({}, headers, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-ops-key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }), body: '' };
  }

  const EXPECTED = process.env.OPS_METRICS_KEY;
  if (!EXPECTED) {
    return { statusCode: 503, headers,
      body: JSON.stringify({ error: 'Reconciliation is not configured on this deploy.' }) };
  }
  const supplied = (event.headers && (event.headers['x-ops-key'] || event.headers['X-Ops-Key'])) || '';
  if (supplied !== EXPECTED) {
    // Terse on purpose, as in ops-metrics: an endpoint that explains why a
    // key was rejected helps someone guess the next one.
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
  const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
  if (!PAYSTACK_SECRET || !SUPABASE_SECRET) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
    const body = event.body ? JSON.parse(event.body) : {};
    const days = Math.min(Math.max(parseInt(body.days, 10) || 7, 1), 90);
    const fromDate = daysAgo(days);

    // ── What Paystack says it took ──
    const paid = await paystackSuccesses(PAYSTACK_SECRET, fromDate);

    // ── What we recorded ──
    const known = {};
    const seen = await supabase.from('payments').select('reference, status, credits_added');
    if (seen.error) throw new Error('Could not read payments: ' + seen.error.message);
    (seen.data || []).forEach(function (r) { known[r.reference] = r; });

    // ── The gap ──
    // Two kinds, and they are different problems.
    //   missing  — Paystack took the money and we have NO row at all. The
    //              customer closed the tab or lost signal before the
    //              redirect. Nothing we have would show this.
    //   stalled  — we have a row, but it never reached success. Money taken,
    //              credits not added, and ops-metrics already counts these.
    const missing = [], stalled = [];
    paid.forEach(function (t) {
      const row = known[t.reference];
      if (!row) { missing.push(t); return; }
      if (row.status !== 'success') {
        stalled.push(Object.assign({ recorded_status: row.status }, t));
      }
    });

    // ── Repair one reference ──
    // By POSTing it to payment-verify, which is the code that already
    // decides these things. Deliberately one at a time, never a bulk loop:
    // if something is wrong, it should go wrong once.
    if (body.repair) {
      const ref = String(body.repair);
      const isKnownToPaystack = paid.some(function (t) { return t.reference === ref; });
      if (!isKnownToPaystack) {
        return { statusCode: 400, headers, body: JSON.stringify({
          error: 'That reference is not a successful live Paystack transaction in the last '
               + days + ' days. Nothing was changed.', reference: ref }) };
      }
      const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '';
      const verifyRes = await fetch('https://' + host + '/.netlify/functions/payment-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref })
      });
      const verifyBody = await verifyRes.json();
      return { statusCode: 200, headers, body: JSON.stringify({
        repaired: ref,
        verify_status: verifyRes.status,
        verify_response: verifyBody,
        note: 'Credits were granted by payment-verify, not by this endpoint.'
      }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({
      checked_from: fromDate,
      days,
      paystack_successful_payments: paid.length,
      // Money taken with no record of it on our side at all.
      missing_entirely: missing,
      // Recorded, but the credits never landed.
      recorded_but_not_credited: stalled,
      healthy: missing.length === 0 && stalled.length === 0,
      how_to_repair: 'POST { "repair": "<reference>" } to this endpoint with the same key. '
                   + 'It forwards the reference to payment-verify, which grants the credits.'
    }) };

  } catch (error) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: 'Reconciliation failed: ' + error.message }) };
  }
};
