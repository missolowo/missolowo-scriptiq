// ============================================
// MISSOLOWO SLATE — LOAD FUNCTION
// Netlify Function — Secure Backend
//
// Two modes:
//   list — the user's productions, newest first, for the sidebar
//   open — one production restored in full: breakdown, schedule,
//          and every call sheet already generated
//
// Charges nothing. Reopening your own work is not a purchase.
//
// Every read is scoped to the calling user. The service key
// bypasses row level security, so ownership is enforced here
// in the query itself — never trust a production_id from the
// browser without checking who it belongs to.
//
// WHO the calling user is comes from a VERIFIED access token, never
// from the request body. It used to come from the body: this function
// read user_email out of the posted JSON and returned that person's
// work, without ever checking the caller was them. Anyone who knew a
// filmmaker's email could read her production list and then the full
// breakdown of any production in it — characters, locations, every
// scene, the schedule, every call sheet.
//
// The queries below were never the problem and are unchanged. They were
// scoped to whoever the caller claimed to be.
// ============================================
const { createClient } = require('@supabase/supabase-js');
const { slateAuthenticate } = require('./lib/slate-core');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (!SUPABASE_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase key' }) };
  }

  try {
    // production_id is still taken from the body — it names WHAT is being
    // asked for. user_email and user_id are deliberately NOT read: they
    // named WHO was asking, and a caller does not get to answer that.
    const { mode, production_id } = JSON.parse(event.body || '{}');

    if (['list', 'open'].indexOf(mode) < 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown load mode: ' + mode }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Who is calling ── verified, not claimed.
    const auth = await slateAuthenticate(event, supabase);
    if (!auth.ok) {
      return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };
    }
    const user = auth.user;
    if (!user) {
      // Verified with Supabase but no profile row yet. There is nothing
      // saved to load, which is not an error worth alarming anyone about.
      return mode === 'list'
        ? { statusCode: 200, headers, body: JSON.stringify({ productions: [] }) }
        : { statusCode: 404, headers, body: JSON.stringify({ error: 'Production not found' }) };
    }

    // ── LIST — the sidebar's Productions view ──
    if (mode === 'list') {
      // Only productions that actually reached a saved breakdown.
      // A row stuck at 'processing' is an abandoned run, not a
      // production the filmmaker would recognise.
      const { data: rows, error } = await supabase
        .from('productions')
        .select('production_id, title, status, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(100);

      if (error) {
        console.error('[Slate] Production list failed:', error.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
      }

      const productions = (rows || []).map(function (r) {
        return {
          production_id: r.production_id,
          title: r.title || 'Untitled Script',
          created_at: r.created_at,
          updated_at: r.updated_at || r.created_at
        };
      });

      return { statusCode: 200, headers, body: JSON.stringify({ productions }) };
    }

    // ── OPEN — restore one production in full ──
    if (!production_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No production_id provided' }) };
    }

    // Ownership is enforced in the query, not after it. A production
    // belonging to someone else simply is not found.
    const { data: production } = await supabase
      .from('productions')
      .select('production_id, title, status, script_text, script_language, created_at, updated_at')
      .eq('production_id', production_id)
      .eq('user_id', user.id)
      .single();

    if (!production) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Production not found' }) };
    }

    const { data: breakdownRow } = await supabase
      .from('breakdowns')
      .select('*')
      .eq('production_id', production_id)
      .eq('user_id', user.id)
      .single();

    const { data: scheduleRow } = await supabase
      .from('schedules')
      .select('schedule_data, start_date, shoot_days, updated_at')
      .eq('production_id', production_id)
      .eq('user_id', user.id)
      .single();

    const { data: callSheetRows } = await supabase
      .from('call_sheets')
      .select('day_number, sheet_data, updated_at')
      .eq('production_id', production_id)
      .eq('user_id', user.id)
      .order('day_number', { ascending: true });

    // Rebuild the breakdown in the shape the workspace expects, so the
    // frontend can drop it straight into slateBreakdown untouched.
    const breakdown = breakdownRow ? {
      title: breakdownRow.title,
      language_detected: breakdownRow.script_language,
      total_scenes: breakdownRow.total_scenes,
      scenes: breakdownRow.scenes || [],
      character_breakdown: breakdownRow.character_breakdown || [],
      outline_schedule: breakdownRow.outline_schedule || [],
      production_elements: breakdownRow.production_elements || {}
    } : null;

    const callSheets = (callSheetRows || []).map(function (r) {
      return { day_number: r.day_number, sheet: r.sheet_data };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        production: {
          production_id: production.production_id,
          title: production.title || 'Untitled Script',
          script_language: production.script_language,
          created_at: production.created_at,
          updated_at: production.updated_at
        },
        // The script itself, so a filmmaker can re-run a breakdown
        // without hunting for the original file.
        script_text: production.script_text || null,
        breakdown,
        schedule: scheduleRow ? scheduleRow.schedule_data : null,
        start_date: scheduleRow ? scheduleRow.start_date : null,
        shoot_days: scheduleRow ? scheduleRow.shoot_days : null,
        call_sheets: callSheets
      })
    };

  } catch (error) {
    console.error('[Slate] Load crash:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
