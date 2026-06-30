// ============================================
// SCRIPTIQ — SCRIPT BREAKDOWN FUNCTION
// CISO Hardened — One chunk per call
// Charges ONE credit only on the final chunk,
// idempotently per production_id (Option Y+ bridge)
// ============================================

const fetch = (() => {
  try { return require('node-fetch'); }
  catch(e) { return global.fetch; }
})();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const ADMIN_EMAILS    = ['missolowoai@gmail.com', 'omoyeni38@gmail.com'];

// ── Inline rate limiter ──
async function checkRateLimit(supabase, ip, functionName, maxRequests, userId = null) {
  try {
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);
    const key = userId ? `user_${userId}__${functionName}` : `ip_${ip}__${functionName}`;

    const { data: existing } = await supabase
      .from('rate_limits').select('*')
      .eq('key', key)
      .gte('window_start', windowStart.toISOString())
      .single();

    if (!existing) {
      await supabase.from('rate_limits').insert({
        key, ip, user_id: userId || null,
        function_name: functionName, count: 1,
        window_start: windowStart.toISOString(),
        created_at: new Date().toISOString()
      });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (existing.count >= maxRequests) return { allowed: false, remaining: 0 };

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

  if (!OPENAI_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing OpenAI key' }) };
  }
  if (!SUPABASE_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase key' }) };
  }

  try {
    const {
      script, language,
      chunk_index, total_chunks, production_id
    } = JSON.parse(event.body);

    if (!script || script.trim().length < 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ════════════════════════════════════════════════════════════
    // AUTHENTICATION GATE — MUST come before rate limit, user lookup,
    // and ANY OpenAI call. No valid Supabase session → 401, stop here.
    // Identity is taken from the verified token, NEVER from the body,
    // so a caller cannot impersonate another user or forge a user_id.
    // ════════════════════════════════════════════════════════════
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      return {
        statusCode: 401, headers,
        body: JSON.stringify({ error: 'Authentication required. Please sign in.', code: 'UNAUTHENTICATED' })
      };
    }

    // Cryptographically verify the token with Supabase. A forged or
    // expired token fails here — this is the real gate.
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData || !authData.user) {
      return {
        statusCode: 401, headers,
        body: JSON.stringify({ error: 'Invalid or expired session. Please sign in again.', code: 'UNAUTHENTICATED' })
      };
    }

    const authedUserId = authData.user.id;
    const authedEmail  = authData.user.email;
    const isAdmin      = ADMIN_EMAILS.includes(authedEmail);

    const totalChunks   = total_chunks || 1;
    const chunkIndex    = chunk_index || 0;
    const isFirstChunk  = chunkIndex === 0;
    const isLastChunk   = chunkIndex === (totalChunks - 1);

    // ── Rate limit — keyed to the VERIFIED user id ──
    if (!isAdmin && isFirstChunk) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(supabase, clientIP, 'breakdown', 5, authedUserId);
      if (!rateLimit.allowed) {
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ error: 'Too many requests. Please try again in an hour.', code: 'RATE_LIMIT_EXCEEDED' })
        };
      }
    }

    // ── Load the verified user's profile (by token-derived id only) ──
    // Never creates a user here — the signup trigger owns account creation.
    let user = null;
    {
      const { data } = await supabase.from('users').select('*').eq('id', authedUserId).single();
      user = data;
    }

    // Profile must exist for an authenticated user. If missing, refuse
    // rather than silently minting one.
    if (!user) {
      return {
        statusCode: 401, headers,
        body: JSON.stringify({ error: 'Account not found. Please sign in again.', code: 'UNAUTHENTICATED' })
      };
    }

    // ── Access guard — only on first chunk (fail fast before any AI cost) ──
    if (user && !isAdmin && isFirstChunk) {
      if (user.is_disabled) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled.' }) };
      }
      if (user.credits_remaining <= 0) {
        return {
          statusCode: 402, headers,
          body: JSON.stringify({ error: 'No credits remaining', code: 'NO_CREDITS', upgrade_required: true })
        };
      }
    }

    // ── Register production on first chunk (idempotent — safe if retried) ──
    if (isFirstChunk && production_id && user) {
      await supabase.from('productions')
        .upsert({
          production_id,
          user_id: user.id,
          status: 'processing',
          created_at: new Date().toISOString()
        }, { onConflict: 'production_id', ignoreDuplicates: true });
    }

    // ── Build prompt ──
    const langInstruction = (!language || language === 'auto')
      ? 'Auto-detect the script language.'
      : `The script is in ${language}.`;

    const sectionNote = totalChunks > 1
      ? `This is section ${chunkIndex + 1} of ${totalChunks} of a longer screenplay. `
      : '';

    const prompt = `You are a professional film script breakdown supervisor. ${sectionNote}Analyze the following screenplay and extract ALL production elements.
${langInstruction}

SCREENPLAY:
${script.trim()}

Return ONLY valid JSON:
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
    { "character": "CHARACTER NAME", "scenes": [1], "total": 1 }
  ],
  "outline_schedule": [
    { "set_location": "Location Name", "scenes": [1], "total": 1 }
  ],
  "production_elements": {
    "all_cast": ["Character Name"],
    "all_props": ["prop item"],
    "all_costume": ["costume item"],
    "all_equipment": ["equipment item"],
    "special_requirements": []
  }
}
RULES:
1. character_breakdown: Sort by total scenes HIGHEST to LOWEST.
2. outline_schedule: Group ALL scenes by location.
3. Include EVERY scene. Empty categories use [].`;

    // ── Call OpenAI ──
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 16000,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await response.json();

    if (!response.ok) {
      console.error('[OpenAI Error]', aiData.error?.message);
      return {
        statusCode: response.status, headers,
        body: JSON.stringify({ error: aiData.error?.message || 'AI processing error' })
      };
    }

    const text = aiData.choices?.[0]?.message?.content || '{}';
    const breakdown = JSON.parse(text.trim());

    // ════════════════════════════════════════════════
    // CREDIT CHARGE — only on LAST chunk, only after this
    // chunk's AI succeeded, idempotent per production_id
    // ════════════════════════════════════════════════
    if (isLastChunk && user && !isAdmin) {
      let alreadyCharged = false;

      // Idempotency guard — has this production already been charged?
      if (production_id) {
        const { data: prod } = await supabase
          .from('productions').select('charged_at')
          .eq('production_id', production_id)
          .single();
        if (prod && prod.charged_at) alreadyCharged = true;
      }

      if (!alreadyCharged) {
        const finalCredits = Math.max(0, user.credits_remaining - 1);
        await supabase.from('users').update({
          credits_remaining: finalCredits,
          credits_used: (user.credits_used || 0) + 1
        }).eq('id', user.id);

        // Mark production charged + completed (idempotency record)
        if (production_id) {
          await supabase.from('productions').upsert({
            production_id,
            user_id: user.id,
            status: 'completed',
            charged_at: new Date().toISOString()
          }, { onConflict: 'production_id' });
        }

        breakdown.credits_remaining = finalCredits;
      } else {
        // Already charged on a previous attempt — do NOT charge again
        breakdown.credits_remaining = user.credits_remaining;
        breakdown.already_charged = true;
      }
      breakdown.user_role = user.role;
    } else if (user) {
      // Non-charging chunk — report current balance for display only
      breakdown.credits_remaining = user.credits_remaining;
      breakdown.user_role = user.role;
    }

    return { statusCode: 200, headers, body: JSON.stringify(breakdown) };

  } catch (error) {
    console.error('[FATAL] Breakdown crash:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to process script: ' + error.message }) };
  }
};
