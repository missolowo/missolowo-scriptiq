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
    const { breakdown, schedule_day, shoot_date, general_call } = JSON.parse(event.body);

    if (!breakdown) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No breakdown data provided' }) };
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ════════════════════════════════════════════════════════════
    // AUTHENTICATION GATE — verify Supabase session before anything.
    // No valid token → 401. Identity comes from the token, not body.
    // ════════════════════════════════════════════════════════════
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required. Please sign in.', code: 'UNAUTHENTICATED' }) };
    }
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData || !authData.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session. Please sign in again.', code: 'UNAUTHENTICATED' }) };
    }
    const authedUserId = authData.user.id;
    const authedEmail  = authData.user.email;
    const isAdminEmail = ['missolowoai@gmail.com','omoyeni38@gmail.com'].includes(authedEmail);

    // ── STEP 1: Rate limit — keyed to verified user ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'callsheet', 5, SUPABASE_SECRET, authedUserId);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'callsheet');
    }

    // ── STEP 3: Load verified user's profile (by token id only) ──
    let user = null;
    {
      const { data } = await supabase.from('users').select('*').eq('id', authedUserId).single();
      user = data;
    }
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Account not found. Please sign in again.', code: 'UNAUTHENTICATED' }) };
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

    // ── STEP 4: Build AI prompt ──
    const prompt = `You are a professional Nollywood production manager generating an industry-standard daily call sheet.

BREAKDOWN DATA:
${JSON.stringify(breakdown, null, 2)}

SHOOT DAY: ${schedule_day || 1}
SHOOT DATE: ${shoot_date || 'Monday 30 June 2026'}
GENERAL CALL TIME: ${general_call || '07:00'}

Generate a professional call sheet based strictly on the matching scenes for this shoot day. Return ONLY valid JSON (no markdown):
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
