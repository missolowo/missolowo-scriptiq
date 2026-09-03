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
// ============================================
const { createClient } = require('@supabase/supabase-js');

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
    const { mode, production_id, user_email, user_id } = JSON.parse(event.body || '{}');

    if (['list', 'open'].indexOf(mode) < 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown load mode: ' + mode }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Identify the caller ──
    let user = null;
    if (user_id || user_email) {
      const query = user_id
        ? supabase.from('users').select('id, is_disabled').eq('id', user_id).single()
        : supabase.from('users').select('id, is_disabled').eq('email', user_email).single();
      const { data } = await query;
      user = data;
    }
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not signed in' }) };
    }
    if (user.is_disabled) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled. Contact support.' }) };
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
