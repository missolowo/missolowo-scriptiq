// ============================================
// MISSOLOWO SLATE — CALL SHEET FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Generates professional call sheet from breakdown + schedule
//
// PRINCIPLE: facts come from data, never from the AI.
// Titles, addresses, scene numbers, sets and locations are copied
// from the breakdown and schedule. The AI is used only for
// judgement — call times and production notes. A call sheet sends
// a crew to a physical place; an invented address is worse than
// a blank one.
// ============================================
const { createClient } = require('@supabase/supabase-js');
const fetch = (() => {
  try { return require('node-fetch'); }
  catch(e) { return global.fetch; }
})();
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

exports.handler = async function(event, context) {
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

  try {
    const { breakdown, schedule, schedule_day, shoot_date, general_call,
            location_address, user_email, user_id } = JSON.parse(event.body);

    if (!breakdown) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No breakdown data provided' }) };
    }

    // Call sheets must be grounded in the REAL schedule, not guessed
    // from a bare day number.
    if (!schedule || !Array.isArray(schedule.schedule)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No schedule data provided. Generate a shooting schedule first, then request the call sheet for a specific day.' }) };
    }

    const targetDay = Number(schedule_day) || 1;
    const dayData = schedule.schedule.find(d => Number(d.day) === targetDay);

    if (!dayData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `No matching day ${targetDay} found in the provided schedule.` }) };
    }

    // Full, rich scene detail for exactly this day's scenes — never the whole script.
    const todaysSceneNumbers = new Set((dayData.scenes || []).map(s => s.scene_number));
    const todaysFullScenes = (breakdown.scenes || []).filter(s => todaysSceneNumbers.has(s.scene_number));

    const isAdminEmail = user_email && ['missolowoai@gmail.com','omoyeni38@gmail.com'].includes(user_email);

    // ── STEP 1: Rate limit — user_id passed to fix the film-set shared-IP issue ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'callsheet', 5, SUPABASE_SECRET, user_id || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'callsheet');
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Single-pass user verification ──
    let user = null;
    if (user_id || user_email) {
      const query = user_id
        ? supabase.from('users').select('*').eq('id', user_id).single()
        : supabase.from('users').select('*').eq('email', user_email).single();
      const { data } = await query;
      user = data;
    }

    // ── STEP 3b: Core access guard ──
    // Call sheets are FREE: the credit was spent on the schedule this
    // sheet derives from (PM ruling, Aug 29). We still block disabled
    // accounts, but we do not gate on credits and we do not charge.
    if (user && !isAdminEmail && user.is_disabled) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled. Contact support.' }) };
    }

    // ── STEP 4: Build the sheet from DATA ──
    function sceneSort(a, b) {
      var na = parseFloat(String(a.scene_number).replace(/[^0-9.]/g, '')) || 0;
      var nb = parseFloat(String(b.scene_number).replace(/[^0-9.]/g, '')) || 0;
      if (na !== nb) return na - nb;
      return String(a.scene_number).localeCompare(String(b.scene_number));
    }

    const scenesToday = todaysFullScenes.slice().sort(sceneSort).map(function (s) {
      return {
        scene_number: s.scene_number,
        int_ext: s.int_ext || 'INT',
        time_of_day: s.time_of_day || 'DAY',
        location: s.location || '',
        // Backward compatible: breakdowns made before the Location/Set
        // split have no set field, so fall back to the location.
        set: s.set || s.location || '',
        description: s.description || '',
        cast: s.cast || [],
        props: s.props || [],
        costume: s.costume || []
      };
    });

    // Which cast work today, and in which scenes
    const castMap = {};
    scenesToday.forEach(function (s) {
      (s.cast || []).forEach(function (c) {
        const name = String(c || '').trim();
        if (!name) return;
        if (!castMap[name]) castMap[name] = { character: name, scenes: [] };
        if (castMap[name].scenes.indexOf(s.scene_number) < 0) {
          castMap[name].scenes.push(s.scene_number);
        }
      });
    });
    const castToday = Object.keys(castMap).map(function (k) { return castMap[k]; });

    const dayLocation = dayData.location || (scenesToday[0] && scenesToday[0].location) || '';

    // ── STEP 5: AI for JUDGEMENT ONLY — call times and notes ──
    // It is never asked for the title, the address, or the scene list,
    // because it does not know them and would invent them.
    let aiNotes = [];
    let aiCallTimes = [];

    try {
      const prompt = `You are a Nollywood first assistant director setting call times for one shoot day.

SHOOT DAY: ${targetDay}
LOCATION: ${dayLocation}
GENERAL CALL: ${general_call || '07:00'}

SCENES TODAY (already fixed — do not add, remove or renumber any):
${JSON.stringify(scenesToday.map(function (s) {
  return { scene: s.scene_number, set: s.set, int_ext: s.int_ext, time: s.time_of_day, cast: s.cast };
}), null, 2)}

CAST WORKING TODAY (use exactly these names):
${JSON.stringify(castToday, null, 2)}

Stagger call times sensibly: cast in the first scenes of the day come in at general call, cast who only appear later can come in later. Write 2 to 4 short production notes covering logistics, moves between sets, night work or continuity.

Return ONLY valid JSON:
{
  "first_shot": "08:30",
  "wrap_estimate": "18:00",
  "cast_call_times": [
    { "character": "EXACT NAME FROM THE LIST ABOVE", "call_time": "07:00", "on_set": "08:30", "status": "Lead" }
  ],
  "production_notes": ["Note 1", "Note 2"]
}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 2000,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a professional Nollywood first assistant director. You always write your output in English, whatever language the source material uses. You never invent scene numbers, locations, addresses or character names — you use exactly what you are given.'
            },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (response.ok) {
        const aiData = await response.json();
        const parsed = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
        aiCallTimes = Array.isArray(parsed.cast_call_times) ? parsed.cast_call_times : [];
        aiNotes = Array.isArray(parsed.production_notes) ? parsed.production_notes : [];
        var aiFirstShot = parsed.first_shot;
        var aiWrap = parsed.wrap_estimate;
      }
    } catch (e) {
      console.warn('[Slate] Call time suggestions unavailable:', e.message);
    }

    // Merge AI times onto the real cast list. Anyone the AI missed still
    // appears, at general call — a crew member must never be dropped from
    // a call sheet because a model forgot them.
    const timeByName = {};
    aiCallTimes.forEach(function (t) {
      if (t && t.character) timeByName[String(t.character).trim()] = t;
    });

    const castCallTimes = castToday.map(function (c) {
      const t = timeByName[c.character] || {};
      return {
        character: c.character,
        call_time: t.call_time || general_call || '07:00',
        on_set: t.on_set || '08:30',
        status: t.status || '',
        scenes: c.scenes
      };
    });

    // ── STEP 6: Assemble. Every fact here comes from data. ──
    const callsheet = {
      title: breakdown.title || 'Untitled Production',
      shoot_day: targetDay,
      shoot_date: shoot_date || dayData.date || '',
      general_call: general_call || '07:00',
      first_shot: (typeof aiFirstShot === 'string' && aiFirstShot) || '08:30',
      wrap_estimate: (typeof aiWrap === 'string' && aiWrap) || '18:00',
      location: dayLocation,
      // NEVER guessed. Blank until a human supplies it.
      location_address: location_address || '',
      location_address_required: !location_address,
      locations: dayData.locations || (dayLocation ? [dayLocation] : []),
      company_move: !!dayData.company_move,
      scenes_today: scenesToday,
      cast_call_times: castCallTimes,
      production_notes: aiNotes.length ? aiNotes : (dayData.production_notes ? [dayData.production_notes] : [])
    };

    // ── STEP 7: Report credits, but never charge for a call sheet ──
    if (user) {
      callsheet.credits_remaining = user.credits_remaining;
      callsheet.user_role = user.role;
    }

    return { statusCode: 200, headers, body: JSON.stringify(callsheet) };

  } catch (error) {
    console.error('[CISO Fatal Catch] Call Sheet processing crash:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to generate call sheet: ' + error.message })
    };
  }
};
