
 // ============================================
// SCRIPTIQ — SCRIPT BREAKDOWN FUNCTION
// CISO Hardened — Self-contained — 502 Fixed
// ============================================

// FIX 1: Explicit node-fetch v2 import — prevents ESM crash
const fetch = (() => {
  try {
    return require('node-fetch');
  } catch(e) {
    return global.fetch;
  }
})();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

const ADMIN_EMAILS = ['missolowoai@gmail.com', 'omoyeni38@gmail.com'];

// ── FIX 2: Inline rate limiter — no external require('./rate-limiter') ──
async function checkRateLimit(supabase, ip, functionName, maxRequests, userId = null) {
  try {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    const key = userId ? `user_${userId}__${functionName}` : `ip_${ip}__${functionName}`;

    const { data: existing } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .gte('window_start', windowStart.toISOString())
      .single();

    if (!existing) {
      await supabase.from('rate_limits').insert({
        key, ip,
        user_id: userId || null,
        function_name: functionName,
        count: 1,
        window_start: windowStart.toISOString(),
        created_at: new Date().toISOString()
      });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    await supabase.from('rate_limits').update({ count: existing.count + 1 }).eq('id', existing.id);
    return { allowed: true, remaining: maxRequests - (existing.count + 1) };

  } catch (err) {
    console.error('[RateLimit] Error:', err.message);
    return { allowed: true, remaining: 99 };
  }
}

function getClientIP(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['x-real-ip'] ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

exports.handler = async function(event) {

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

  // FIX 3: Validate environment variables at startup
  if (!OPENAI_API_KEY) {
    console.error('[FATAL] OPENAI_API_KEY is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error: Missing OpenAI key' })
    };
  }

  if (!SUPABASE_SECRET) {
    console.error('[FATAL] SUPABASE_SECRET_KEY is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error: Missing Supabase key' })
    };
  }

  try {
    const { script, language, user_email, user_id } = JSON.parse(event.body);

    if (!script || script.trim().length < 10) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No script provided' })
      };
    }

    const isAdmin = ADMIN_EMAILS.includes(user_email);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Rate limit check ──
    if (!isAdmin) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(supabase, clientIP, 'breakdown', 5, user_id || null);
      if (!rateLimit.allowed) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'Too many requests. Please try again in an hour.',
            code: 'RATE_LIMIT_EXCEEDED'
          })
        };
      }
    }

    // ── Get user ──
    let user = null;
    if (user_id) {
      const { data } = await supabase.from('users').select('*').eq('id', user_id).single();
      user = data;
    } else if (user_email) {
      const { data } = await supabase.from('users').select('*').eq('email', user_email).single();
      if (!data) {
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

    // ── Access guard ──
    if (user && !isAdmin) {
      if (user.is_disabled) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled.' }) };
      }
      if (user.credits_remaining <= 0) {
        return {
          statusCode: 402,
          headers,
          body: JSON.stringify({
            error: 'No credits remaining',
            code: 'NO_CREDITS',
            upgrade_required: true
          })
        };
      }
    }

    // ── Build prompt ──
    const langInstruction = (!language || language === 'auto')
      ? 'Auto-detect the script language.'
      : `The script is in ${language}.`;

    const prompt = `You are a professional film script breakdown supervisor. Analyze the following screenplay and extract ALL production elements.

${langInstruction}

SCREENPLAY:
${script}

Return ONLY valid JSON in this exact structure:
{
  "title": "Script title or Untitled Script",
  "language_detected": "detected language",
  "total_scenes": 2,
  "scenes": [
    {
      "scene_number": 1,
      "int_ext": "INT",
      "time_of_day": "DAY",
      "location": "Location name",
      "description": "One sentence summary",
      "cast": ["Character Name"],
      "props": ["prop item"],
      "costume": ["costume item"],
      "equipment": ["equipment item"],
      "production_notes": "Notes"
    }
  ],
  "character_breakdown": [
    {
      "character": "CHARACTER NAME",
      "scenes": [1, 2],
      "total": 2
    }
  ],
  "outline_schedule": [
    {
      "set_location": "Location Name",
      "scenes": [1],
      "total": 1
    }
  ],
  "production_elements": {
    "all_cast": ["Character Name"],
    "all_props": ["prop item"],
    "all_costume": ["costume item"],
    "all_equipment": ["equipment item"],
    "special_requirements": []
  }
}`;

    // ── Call OpenAI ──
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
        response_format: { type: "json_object" },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();

    if (!response.ok) {
      console.error('[OpenAI Error]', aiData.error?.message);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: aiData.error?.message || 'AI processing error' })
      };
    }

    const text = aiData.choices?.[0]?.message?.content || '{}';
    const breakdown = JSON.parse(text.trim());

    // ── Deduct credit & save ──
    if (user) {
      let finalCredits = user.credits_remaining;

      if (!isAdmin) {
        finalCredits = user.credits_remaining - 1;
        await supabase.from('users').update({
          credits_remaining: finalCredits,
          credits_used: (user.credits_used || 0) + 1
        }).eq('id', user.id);
      }

      await supabase.from('breakdowns').insert({
        user_id: user.id,
        title: breakdown.title || 'Untitled Script',
        script_language: breakdown.language_detected || 'Unknown',
        scenes: breakdown.scenes || [],
        character_breakdown: breakdown.character_breakdown || [],
        outline_schedule: breakdown.outline_schedule || [],
        production_elements: breakdown.production_elements || {},
        total_scenes: breakdown.total_scenes || 0,
        credits_used: isAdmin ? 0 : 1
      });

      breakdown.credits_remaining = finalCredits;
      breakdown.user_role = user.role;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(breakdown)
    };

  } catch (error) {
    console.error('[FATAL] Breakdown crash:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process script: ' + error.message })
    };
  }
};
