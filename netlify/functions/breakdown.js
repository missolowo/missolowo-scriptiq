// ============================================
// SCRIPTIQ — SCRIPT BREAKDOWN FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Auth → Rate Limit → Credit Check → AI Call → Save → Return
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
    const { script, language, user_email, user_id } = JSON.parse(event.body);

    if (!script) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };
    }

    const isAdminEmail = user_email && ['missolowoai@gmail.com','omoyeni38@gmail.com'].includes(user_email);

    // ── STEP 1: Rate limit — Passing user_id to fix the Film Set Wi-Fi shared-IP issue ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      // FIX 3: Pass user_id into the rate limiter module directly
      const rateLimit = await checkRateLimit(clientIP, 'breakdown', 5, SUPABASE_SECRET, user_id);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'breakdown');
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Get or create user profile ──
    let user = null;

    if (user_id) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('id', user_id)
        .single();
      user = data;
    } else if (user_email) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('email', user_email)
        .single();

      if (!data) {
        // Fallback profile builder if signup trigger delayed
        const { data: newUser } = await supabase
          .from('users')
          .insert({ email: user_email, role: 'free', credits_remaining: 3 })
          .select()
          .single();
        user = newUser;
      } else {
        user = data;
      }
    }

    // ── STEP 3b: Core Access Guard ──
    if (user && !isAdminEmail) {
      // 1. Check if disabled
      if (user.is_disabled) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled. Contact support.' }) };
      }
      // FIX 2: Check credits for ALL non-admin tiers to prevent paid-tier unlimited bypass exploits
      if (user.credits_remaining <= 0) {
        return {
          statusCode: 402,
          headers,
          body: JSON.stringify({
            error: 'No credits remaining',
            code: 'NO_CREDITS',
            message: 'You have used all your script credits. Please purchase a top-up pack to continue.',
            upgrade_required: true
          })
        };
      }
    }

    // ── STEP 4: Build AI prompt ──
    const langInstruction = (!language || language === 'auto')
      ? 'Auto-detect the script language.'
      : `The script is in ${language}.`;

    const prompt = `You are a professional film script breakdown supervisor with real production management experience. Analyze the following screenplay and extract ALL production elements professionally.
${langInstruction} Support English, Yoruba, Igbo, Hausa, French, Spanish, Portuguese, German, Italian, Turkish, Arabic, Chinese, Japanese, Korean, and Hindi.

SCREENPLAY:
${script}

Return ONLY valid JSON in this exact structure:
{
  "title": "Script title or Untitled Script",
  "language_detected": "detected language",
  "total_scenes": number,
  "scenes": [
    {
      "scene_number": 1,
      "int_ext": "INT or EXT",
      "time_of_day": "DAY or NIGHT or DAWN or DUSK",
      "location": "Location name",
      "description": "One sentence summary of scene action",
      "cast": ["Character Name"],
      "props": ["prop item"],
      "costume": ["character: costume description"],
      "equipment": ["equipment item"],
      "production_notes": "Special requirements or notes"
    }
  ],
  "character_breakdown": [
    {
      "character": "CHARACTER NAME",
      "scenes": [1, 3, 5, 7],
      "total": 4
    }
  ],
  "outline_schedule": [
    {
      "set_location": "Location/Set Name",
      "scenes": [2, 4, 6, 8],
      "total": 4
    }
  ],
  "production_elements": {
    "all_cast": ["Character Name"],
    "all_props": ["prop item"],
    "all_costume": ["costume item"],
    "all_equipment": ["equipment item"],
    "special_requirements": ["special requirement"]
  }
}

RULES:
1. character_breakdown: Sort by total scenes HIGHEST to LOWEST.
2. outline_schedule: Group ALL scenes by location.
3. Include EVERY scene. No limits.
4. Empty categories use [].`;

    // ── STEP 5: Call OpenAI with strict Native JSON Enforcement ──
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 8000,
        temperature: 0.3,
        response_format: { type: "json_object" }, // FIX 4: Enforces strict programmatic JSON parsing
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
    const breakdown = JSON.parse(text.trim());

    // ── STEP 6: Deduct credit uniformly & save breakdown ──
    if (user) {
      let finalRemainingCredits = user.credits_remaining;

      if (!isAdminEmail) {
        finalRemainingCredits = user.credits_remaining - 1;

        // Deduct 1 credit across ALL paying tiers and update stats
        await supabase
          .from('users')
          .update({
            credits_remaining: finalRemainingCredits,
            credits_used: user.credits_used + 1
          })
          .eq('id', user.id);
      }

      // Save breakdown payload safely to database
      await supabase
        .from('breakdowns')
        .insert({
          user_id: user.id,
          title: breakdown.title || 'Untitled Script',
          script_language: breakdown.language_detected || 'Unknown',
          scenes: breakdown.scenes || [],
          character_breakdown: breakdown.character_breakdown || [],
          outline_schedule: breakdown.outline_schedule || [],
          production_elements: breakdown.production_elements || {},
          total_scenes: breakdown.total_scenes || 0,
          credits_used: isAdminEmail ? 0 : 1
        });

      // Synchronize response fields for frontend tracking renders
      breakdown.credits_remaining = finalRemainingCredits;
      breakdown.user_role = user.role;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(breakdown)
    };

  } catch (error) {
    console.error("[CISO Fatal Catch] Breakdown processing crash:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process script: ' + error.message })
    };
  }
};
