// ============================================
// MISSOLOWO SLATE — SAVE FUNCTION
// Netlify Function — Secure Backend
//
// Stores the ASSEMBLED breakdown, the schedule, and call sheets
// against a production. The breakdown is chunked, so the complete
// version only ever exists in the browser — this is where it comes
// back to be stored.
//
// Charges nothing. Saving is not billing. A filmmaker must never
// pay to keep work they have already paid to generate.
//
// Every write is validated against the production row first:
// the production must exist and belong to the caller.
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
    const { kind, production_id, user_email, user_id, payload, day_number } = JSON.parse(event.body || '{}');

    if (!production_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No production_id provided' }) };
    }
    if (!payload || typeof payload !== 'object') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No payload provided' }) };
    }
    if (['breakdown', 'schedule', 'callsheet'].indexOf(kind) < 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown save kind: ' + kind }) };
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

    // ── Ownership check: the production must exist and be theirs ──
    // The browser sends the payload, so it could send anything. It
    // cannot, however, write into someone else's production.
    const { data: production } = await supabase
      .from('productions')
      .select('production_id, user_id')
      .eq('production_id', production_id)
      .single();

    if (!production) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Production not found' }) };
    }
    if (production.user_id !== user.id) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'This production belongs to another account' }) };
    }

    const now = new Date().toISOString();
    let result;

    // ── BREAKDOWN — the assembled one, replacing the partial chunk save ──
    if (kind === 'breakdown') {
      const scenes = Array.isArray(payload.scenes) ? payload.scenes : [];
      if (!scenes.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Breakdown contains no scenes' }) };
      }

      result = await supabase.from('breakdowns').upsert({
        production_id,
        user_id: user.id,
        title: payload.title || 'Untitled Script',
        script_language: payload.language_detected || 'auto',
        output_language: 'English',
        scenes,
        character_breakdown: payload.character_breakdown || [],
        outline_schedule: payload.outline_schedule || [],
        production_elements: payload.production_elements || {},
        total_scenes: scenes.length,
        created_at: now
      }, { onConflict: 'production_id' });

      if (!result.error) {
        await supabase.from('productions').update({
          title: payload.title || 'Untitled Script',
          status: 'completed',
          updated_at: now
        }).eq('production_id', production_id);
      }
    }

    // ── SCHEDULE — one per production, regenerated in place ──
    if (kind === 'schedule') {
      const days = Array.isArray(payload.schedule) ? payload.schedule : [];
      if (!days.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Schedule contains no days' }) };
      }

      result = await supabase.from('schedules').upsert({
        production_id,
        user_id: user.id,
        title: payload.title || null,
        start_date: payload.start_date || null,
        shoot_days: days.length,
        schedule_data: payload,
        created_at: now,
        updated_at: now
      }, { onConflict: 'production_id' });

      if (!result.error) {
        await supabase.from('productions').update({ updated_at: now }).eq('production_id', production_id);
      }
    }

    // ── CALL SHEET — one per shoot day, regenerated in place ──
    if (kind === 'callsheet') {
      const day = Number(day_number || payload.shoot_day);
      if (!day || day < 1) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid day_number provided' }) };
      }

      result = await supabase.from('call_sheets').upsert({
        production_id,
        user_id: user.id,
        day_number: day,
        sheet_data: payload,
        created_at: now,
        updated_at: now
      }, { onConflict: 'production_id,day_number' });

      if (!result.error) {
        await supabase.from('productions').update({ updated_at: now }).eq('production_id', production_id);
      }
    }

    if (result && result.error) {
      console.error('[Slate] Save failed:', kind, result.error.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          saved: false,
          error: result.error.message,
          details: result.error.details || ''
        })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ saved: true, kind, production_id }) };

  } catch (error) {
    console.error('[Slate] Save crash:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ saved: false, error: error.message }) };
  }
};
