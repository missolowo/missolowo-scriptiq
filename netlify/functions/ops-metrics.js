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

const { ADMIN_EMAILS } = require('./lib/slate-core');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

// ── Whose activity is OURS, not a customer's ──
// Three weeks of engine work ran the same fixture scripts over and over, so
// the raw counts read as demand when they are really our own debugging.
// Admin accounts are therefore counted separately, and the headline numbers
// mean customers.
//
// An account is ours if its role is admin, or its address is on this list.
// Add an address here to exclude it — no other change needed.
const INTERNAL_EMAILS = ADMIN_EMAILS.concat([
  // Accounts used for building and testing. Gmail treats a +suffix as the
  // same inbox, so these are all the same two people.
]);

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
    if (filter && filter.excludeUsers && filter.excludeUsers.length) {
      q = q.not('user_id', 'in', '(' + filter.excludeUsers.join(',') + ')');
    }
    if (filter && filter.onlyUsers && filter.onlyUsers.length) {
      q = q.in('user_id', filter.onlyUsers);
    }
    if (filter && filter.excludeIds && filter.excludeIds.length) {
      q = q.not('id', 'in', '(' + filter.excludeIds.join(',') + ')');
    }
    if (filter && filter.onlyIds && filter.onlyIds.length) {
      q = q.in('id', filter.onlyIds);
    }
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

    // Find our own accounts once, then exclude their rows everywhere.
    // If this lookup fails we report internal_ids as null and leave the
    // counts unfiltered rather than silently reporting the wrong thing.
    let internalIds = [];
    let internalKnown = false;
    try {
      const { data, error } = await supabase.from('users').select('id, email, role');
      if (!error && data) {
        internalKnown = true;
        internalIds = data.filter(function (u) {
          if (u.role === 'admin') return true;
          const e = String(u.email || '').toLowerCase();
          if (INTERNAL_EMAILS.indexOf(e) !== -1) return true;
          // someone+test@gmail.com is the same person as someone@gmail.com
          const base = e.replace(/\+[^@]*(?=@)/, '');
          return INTERNAL_EMAILS.indexOf(base) !== -1;
        }).map(function (u) { return u.id; });
      }
    } catch (e) { internalKnown = false; }

    const windows = { today: since(0), week: since(7), month: since(30) };
    const out = { generated_at: new Date().toISOString(), windows: Object.keys(windows).concat('all_time') };

    // The users table keys on id, everything else on user_id.
    function scope(internal, table) {
      if (!internalKnown || !internalIds.length) return {};
      const idField = (table === 'users');
      if (internal) return idField ? { onlyIds: internalIds } : { onlyUsers: internalIds };
      return idField ? { excludeIds: internalIds } : { excludeUsers: internalIds };
    }

    async function block(table, internal, extra) {
      const base = Object.assign({}, scope(internal, table), extra || {});
      return {
        today:    await countRows(supabase, table, Object.assign({ since: windows.today }, base)),
        week:     await countRows(supabase, table, Object.assign({ since: windows.week }, base)),
        month:    await countRows(supabase, table, Object.assign({ since: windows.month }, base)),
        all_time: await countRows(supabase, table, base)
      };
    }

    // Headline numbers are CUSTOMERS. Our own testing is reported beside
    // them under "internal", so it is visible but never mistaken for demand.
    const internal = {};
    for (const t of TABLES) {
      out[t.key] = await block(t.table, false);
      internal[t.key] = await block(t.table, true);
    }

    const payments = {}, internalPayments = {};
    for (const state of Object.keys(PAYMENT_STATES)) {
      const statuses = PAYMENT_STATES[state];
      payments[state] = await block('payments', false, { statuses });
      internalPayments[state] = await block('payments', true, { statuses });
    }
    out.payments = payments;
    internal.payments = internalPayments;

    // ── Completion rate ──
    // A production row is created when a script is uploaded; a breakdown row
    // only when the run finishes and saves. So the gap between them is
    // uploads that never produced a document — failed partway, abandoned, or
    // completed but failed to save.
    //
    // It is the difference between "filmmakers are trying it" and
    // "filmmakers are getting something out of it", and a falling rate is an
    // early warning that nothing else here would show.
    function rate(block) {
      const out = {};
      ['today', 'week', 'month', 'all_time'].forEach(function (w) {
        const started = block.productions && block.productions[w];
        const finished = block.breakdowns && block.breakdowns[w];
        // null, not 0, when either count is unreadable or nothing started:
        // a rate of zero would read as total failure rather than no activity.
        out[w] = (typeof started === 'number' && typeof finished === 'number' && started > 0)
          ? Math.round((finished / started) * 100)
          : null;
      });
      return out;
    }
    out.completion_rate = rate(out);
    internal.completion_rate = rate(internal);

    out.internal = internal;
    // Honest about its own blind spot: if we could not read the user list,
    // nothing is excluded and the headline numbers include our testing.
    out.internal_accounts_identified = internalKnown ? internalIds.length : null;

    // The launch offer runs on distinct paying customers, so the automation
    // can see how close we are without reading anyone's payment record.
    try {
      const { data } = await supabase.from('payments').select('user_id').eq('status', 'success');
      const seen = {}, seenInternal = {};
      (data || []).forEach(function (r) {
        if (!r.user_id) return;
        if (internalIds.indexOf(r.user_id) !== -1) seenInternal[r.user_id] = true;
        else seen[r.user_id] = true;
      });
      // This is the figure the launch offer runs on, so it must count
      // customers only — our own test purchases must not use up the 100.
      out.paying_customers = Object.keys(seen).length;
      internal.paying_customers = Object.keys(seenInternal).length;
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
