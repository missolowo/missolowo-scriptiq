// ============================================
// SCRIPTIQ — CALL SHEET FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Generates professional call sheet from breakdown + schedule
// ============================================
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch'); // FIX 1: Explicitly use node-fetch to prevent runtime crashes
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
const { breakdown, schedule, schedule_day, shoot_date, general_call, user_email, user_id } = JSON.parse(event.body);

    if (!breakdown) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No breakdown data provided' }) };
    }

    // FIX (Aug 2026): call sheets must be grounded in the REAL schedule,
    // not guessed from a bare day number.
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

    // ── STEP 1: Rate limit — Passing user_id to fix the Film Set Wi-Fi shared-IP issue ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'callsheet', 5, SUPABASE_SECRET, user_id || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'callsheet');
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Single-Pass User Verification (Fixes UUID crashes and race conditions) ──
    let user = null;
    if (user_id || user_email) {
      const query = user_id
        ? supabase.from('users').select('*').eq('id', user_id).single()
        : supabase.from('users').select('*').eq('email', user_email).single();
      const { data } = await query;
      user = data;
    }

    // ── STEP 3b: Core Access Guard ──
    if (user && !isAdminEmail) {
      if (user.is_disabled) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled. Contact support.' }) };
      }
      // FIX 2: Check credits for ALL non-admin tiers to prevent paid-tier bypass exploits
      if (user.credits_remaining <= 0) {
        return {
          statusCode: 402,
          headers,
          body: JSON.stringify({
            error: 'No credits remaining',
            code: 'NO_CREDITS',
            message: 'You have used all your call sheet credits. Please purchase a top-up pack to continue.',
            upgrade_required: true
          })
        };
      }
    }

// ── STEP 4: Build AI prompt — grounded in the real schedule for this day ──
    const prompt = `You are a professional Nollywood production manager generating an industry-standard daily call sheet.

TODAY'S SCENES (the ONLY scenes to include — this is the authoritative shoot-day assignment from the approved schedule):
${JSON.stringify(todaysFullScenes, null, 2)}

DAY LOCATION: ${dayData.location || 'See scenes'}
DAY PRODUCTION NOTES: ${dayData.production_notes || 'None'}

SHOOT DAY: ${targetDay}
SHOOT DATE: ${shoot_date || dayData.date || 'Monday 30 June 2026'}
GENERAL CALL TIME: ${general_call || '07:00'}

Generate a professional call sheet using ONLY the scenes listed above — do not include or invent any other scenes. Return ONLY valid JSON (no markdown):
{
  "title": "project title",
  "shoot_day": 1,
  "shoot_date": "Monday 30 June 2026",
  "general_call": "07:00",
  "first_shot": "08:30",
  "wrap_estimate": "18:00",
  "location": "Location name",
  "location_address": "Full address",
  "scenes_today": [
    {
      "scene_number": 1,
      "int_ext": "INT",
      "time_of_day": "DAY",
      "location": "Location",
      "description": "Scene description",
      "cast": ["Character Name"]
    }
  ],
  "cast_call_times": [
    {
      "character": "CHARACTER NAME",
      "call_time": "07:00",
      "on_set": "08:30",
      "status": "Lead",
      "scenes": [1]
    }
  ],
  "production_notes": ["Note 1", "Note 2"]
}`;

    // ── STEP 5: Call OpenAI with strict Native JSON Enforcement ──
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 3000,
        temperature: 0.3,
        response_format: { type: "json_object" }, // FIX 3: Enforces strict programmatic JSON parsing
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: aiData.error?.message || 'AI error' }) };
    }

    const text = aiData.choices?.[0]?.message?.content || '{}';
    const callsheet = JSON.parse(text.trim());

    // ── STEP 6: Deduct credit uniformly using pre-fetched user context ──
    if (user) {
      let finalRemainingCredits = user.credits_remaining;

      if (!isAdminEmail) {
        finalRemainingCredits = user.credits_remaining - 1;

        // Deduct 1 credit across ALL paying tiers uniformly
        await supabase
          .from('users')
          .update({
            credits_remaining: finalRemainingCredits,
            credits_used: user.credits_used + 1
          })
          .eq('id', user.id);
      }

      // Synchronize response fields for frontend tracking renders
      callsheet.credits_remaining = finalRemainingCredits;
      callsheet.user_role = user.role;
    }

    return { statusCode: 200, headers, body: JSON.stringify(callsheet) };

  } catch (error) {
    console.error("[CISO Fatal Catch] Call Sheet processing crash:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to generate call sheet: ' + error.message })
    };
  }
};
