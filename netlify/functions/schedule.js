// ============================================
// SCRIPTIQ — SHOOTING SCHEDULE FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Takes breakdown data and generates shooting schedule
// Columns: Day | Date | Location | Scene No | Cast Required | INT/EXT | Props
// ============================================
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch'); // FIX 1: Explicitly use node-fetch to prevent crashes
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
    const { breakdown, start_date, shoot_days, user_email, user_id } = JSON.parse(event.body);

    if (!breakdown) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No breakdown data provided' }) };
    }

    const isAdminEmail = user_email && ['missolowoai@gmail.com','omoyeni38@gmail.com'].includes(user_email);

    // ── STEP 1: Rate limit — Passing user_id to fix the Film Set Wi-Fi shared-IP issue ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'schedule', 5, SUPABASE_SECRET, user_id || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'schedule');
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Single-Pass User Verification (Fixes Duplicate Race Conditions) ──
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
            message: 'You have used all your scheduling credits. Please purchase a top-up pack to continue.',
            upgrade_required: true
          })
        };
      }
    }

    // ── STEP 4: Build AI prompt ──
    const prompt = `You are a professional Nollywood film production manager with real scheduling experience.

Based on this script breakdown data, generate a complete shooting schedule.

BREAKDOWN DATA:
${JSON.stringify(breakdown, null, 2)}

START DATE: ${start_date || 'Monday 30 June 2026'}
SHOOT DAYS: ${shoot_days || breakdown.total_scenes || 10}

SCHEDULING RULES:
1. Group scenes by LOCATION to minimize company moves
2. Group INT scenes together, EXT scenes together where possible
3. NIGHT scenes should be scheduled at end of day or separate night shoot days
4. Consider cast availability — minimize days per actor
5. Each shoot day should have a reasonable number of scenes

Return ONLY valid JSON (no markdown):
{
  "title": "project title",
  "total_shoot_days": 3,
  "total_scenes": 4,
  "schedule": [
    {
      "day": 1,
      "date": "Monday 30 June 2026",
      "location": "Location Name",
      "scenes": [
        {
          "scene_number": 1,
          "int_ext": "INT",
          "time_of_day": "DAY",
          "description": "brief scene description",
          "cast_required": ["Character Name"],
          "props": ["prop item"]
        }
      ],
      "production_notes": "Any important notes for this day"
    }
  ],
  "cast_release_schedule": [
    {
      "character": "CHARACTER NAME",
      "days_required": [1, 2],
      "release_day": 3
    }
  ]
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
        max_tokens: 4000,
        temperature: 0.3,
        response_format: { type: "json_object" }, // FIX 3: Enforces strict programmatic JSON parsing
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: aiData.error?.message || 'AI processing error' })
      };
    }

    const text = aiData.choices?.[0]?.message?.content || '{}';
    const schedule = JSON.parse(text.trim());

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
      schedule.credits_remaining = finalRemainingCredits;
      schedule.user_role = user.role;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(schedule)
    };

  } catch (error) {
    console.error("[CISO Fatal Catch] Schedule processing crash:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to generate schedule: ' + error.message })
    };
  }
};
