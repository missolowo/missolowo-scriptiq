// ============================================
// MISSOLOWO SLATE — OPS METRICS
// ============================================
// Counts, and nothing else. Built for the automation workstream, which
// needs to know what the product is doing without being handed the keys
// to the database — and for us, so a run of failed payments is visible
// before a customer has to write in about it.
//
// WHAT IT NEVER RETURNS: names, email addresses, script content, titles,
// payment references, amounts. Every figure here is a row count. If a
// future metric cannot be expressed as a count, it does not belong in
// this file.
//
// Requires OPS_METRICS_KEY, sent as x-ops-key or ?key=. Individually the
// numbers are harmless; together they are our signup and revenue rate,
// which is nobody else's business.
// ============================================
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

// Every table is counted the same way, so adding one is a line here.
const TABLES = [
  { key: 'breakdowns',  table: 'breakdowns'  },
  { key: 'schedules',   table: 'schedules'   },
  { key: 'call_sheets', table: 'call_sheets' },
  { key: 'productions', table: 'productions' },
  { key: 'signups',     table: 'users'       },
  { key: 'feedback',    table: 'feedback'    }
];

// Payments are counted by outcome, because the outcomes are what matter.
// "stalled" is the one to watch: money taken, credits not yet added.
const PAYMENT_STATES = {
  succeeded:  ['success'],
  stalled:    ['processing', 'crediting', 'credit_failed', 'unmatched_user'],
  failed:     ['failed'],
  suspicious: ['suspicious']
};

function since(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// A count that cannot be read returns null rather than failing the whole
// response. One missing table should not blind the automation to the rest.
async function countRows(supabase, table, filter) {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filter && filter.since) q = q.gte('created_at', filter.since);
    if (filter && filter.statuses) q = q.in('status', filter.statuses);
    const { count, error } = await q;
    if (error) return null;
    return typeof count === 'number' ? count : null;
  } catch (e) {
    return null;
  }
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: Object.assign({}, headers, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-ops-key',
      'Access-Control-Allow-Methods': 'GET, OPTIONS' }), body: '' };
  }

  const EXPECTED = process.env.OPS_METRICS_KEY;
  if (!EXPECTED) {
    return { statusCode: 503, headers,
      body: JSON.stringify({ error: 'Metrics are not configured on this deploy.' }) };
  }

  const supplied = (event.headers && (event.headers['x-ops-key'] || event.headers['X-Ops-Key']))
    || (event.queryStringParameters && event.queryStringParameters.key)
    || '';
  if (supplied !== EXPECTED) {
    // Deliberately terse. An endpoint that explains why a key was rejected
    // is an endpoint that helps someone guess the next one.
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_SECRET) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    const windows = { today: since(0), week: since(7), month: since(30) };
    const out = { generated_at: new Date().toISOString(), windows: Object.keys(windows).concat('all_time') };

    for (const t of TABLES) {
      out[t.key] = {
        today:    await countRows(supabase, t.table, { since: windows.today }),
        week:     await countRows(supabase, t.table, { since: windows.week }),
        month:    await countRows(supabase, t.table, { since: windows.month }),
        all_time: await countRows(supabase, t.table)
      };
    }

    const payments = {};
    for (const state of Object.keys(PAYMENT_STATES)) {
      const statuses = PAYMENT_STATES[state];
      payments[state] = {
        today:    await countRows(supabase, 'payments', { since: windows.today, statuses }),
        week:     await countRows(supabase, 'payments', { since: windows.week, statuses }),
        month:    await countRows(supabase, 'payments', { since: windows.month, statuses }),
        all_time: await countRows(supabase, 'payments', { statuses })
      };
    }
    out.payments = payments;

    // The launch offer runs on distinct paying customers, so the automation
    // can see how close we are without reading anyone's payment record.
    try {
      const { data } = await supabase.from('payments').select('user_id').eq('status', 'success');
      const seen = {};
      (data || []).forEach(function (r) { if (r.user_id) seen[r.user_id] = true; });
      out.paying_customers = Object.keys(seen).length;
    } catch (e) {
      out.paying_customers = null;
    }

    // Worth an alert on the automation side: money taken, credits not added.
    out.needs_attention = {
      stalled_payments: (payments.stalled && payments.stalled.all_time) || 0,
      suspicious_payments: (payments.suspicious && payments.suspicious.all_time) || 0
    };

    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (error) {
    return { statusCode: 500, headers,
      body: JSON.stringify({ error: 'Could not read metrics: ' + error.message }) };
  }
};
