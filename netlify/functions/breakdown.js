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
      script, language, user_email, user_id,
      chunk_index, total_chunks, production_id
    } = JSON.parse(event.body);

    if (!script || script.trim().length < 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };
    }

    const isAdmin       = ADMIN_EMAILS.includes(user_email);
    const totalChunks   = total_chunks || 1;
    const chunkIndex    = chunk_index || 0;
    const isFirstChunk  = chunkIndex === 0;
    const isLastChunk   = chunkIndex === (totalChunks - 1);
    const supabase      = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Rate limit — only on first chunk so multi-chunk jobs aren't self-blocked ──
    if (!isAdmin && isFirstChunk) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(supabase, clientIP, 'breakdown', 5, user_id || null);
      if (!rateLimit.allowed) {
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ error: 'Too many requests. Please try again in an hour.', code: 'RATE_LIMIT_EXCEEDED' })
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
          .from('users').insert({ email: user_email, role: 'free', credits_remaining: 3 })
          .select().single();
        user = newUser;
      } else {
        user = data;
      }
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
       // Output is ALWAYS English regardless of the script's language (PM ruling,
    // Aug 2026). This also prevents the same place appearing twice under
    // different languages, e.g. "Ile Abake" and "Abake's House".
        const langInstruction = ((!language || language === 'auto')
      ? 'The screenplay may be in any language. Detect it for PARSING ONLY. '
      : `The script is in ${language}. Use that for PARSING ONLY. `)
      + 'OUTPUT LANGUAGE IS ALWAYS ENGLISH, whatever language the screenplay is '
      + 'written in. Every scene description, location name, set name, prop, costume '
      + 'and equipment item must be written in English. Translate location and set '
      + 'names to English and use the SAME English name for the same physical place '
      + 'every time it appears. Keep character names exactly as written in the script.';
    const sectionNote = totalChunks > 1
      ? `This is section ${chunkIndex + 1} of ${totalChunks} of a longer screenplay. `
      : '';

    const prompt = `You are a professional film script breakdown supervisor. ${sectionNote}Analyze the following screenplay and extract ALL production elements.
${langInstruction}

LOCATION vs SET — this distinction drives scheduling, so get it right:
- "location" is the place the crew TRAVELS TO: a building, compound or area. This becomes the call sheet address. Example: "Baale's House".
- "set" is the specific space INSIDE that location where the scene is shot. Example: "Sitting Room", "Backyard", "Parlour".
- A heading like "INT. BAALE'S SITTING ROOM" means location "Baale's House", set "Sitting Room".
- Use the SAME location string for every space in the same building, so the whole building can be shot in one visit.
- If a heading names a place with no interior space, such as "EXT. BUS STOP", repeat the location as the set.

SCREENPLAY:
${script.trim()}

REMINDER: write every description, location, set, prop, costume and equipment value in ENGLISH, even though the screenplay above may be in another language. Character names stay exactly as written.

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
      "location": "Travel destination, in English",
      "set": "Space within that location, in English",
      "description": "One sentence summary, in English",
      "cast": ["Character Name"],
      "props": ["prop item, in English"],
      "costume": ["costume item, in English"],
      "equipment": ["equipment item, in English"],
      "production_notes": "Notes, in English"
    }
  ],
  "character_breakdown": [
    { "character": "CHARACTER NAME", "scenes": [1], "total": 1 }
  ],
  "outline_schedule": [
    { "set_location": "Location Name, in English", "scenes": [1], "total": 1 }
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
        temperature: 0.1,
        response_format: { type: "json_object" },
              messages: [
          {
            role: 'system',
            content: 'You are a professional film script breakdown supervisor. You read screenplays in any language, but you ALWAYS write your output in English. Scene descriptions, location names, set names, props, costume and equipment are written in English every time, without exception, even when the screenplay is in Yoruba, Igbo, Hausa, French, Arabic or any other language. Never copy or paraphrase the screenplay in its original language. Character names are the only exception: keep those exactly as written. This rule applies to every scene in the output, including the last one.'
          },
          { role: 'user', content: prompt }
        ]
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

    // ── Persist the hed breakdown ──
    // Deliberately OUTSIDE the credit block: saving is not billing.
    // Admins and non-charging paths must still have their work stored.
    if (isLastChunk && user && production_id) {
      try {
        const saveResult = await supabase.from('breakdowns').upsert({
          production_id,
          user_id: user.id,
          title: breakdown.title || 'Untitled Script',
          script_language: breakdown.language_detected || language || 'auto',
          output_language: 'English',
          scenes: breakdown.scenes || [],
          character_breakdown: breakdown.character_breakdown || [],
          outline_schedule: breakdown.outline_schedule || [],
          production_elements: breakdown.production_elements || {},
          total_scenes: breakdown.total_scenes || (breakdown.scenes || []).length,
          created_at: new Date().toISOString()
        }, { onConflict: 'production_id' });

        if (saveResult && saveResult.error) {
          breakdown.save_error = saveResult.error.message;
          breakdown.save_error_details = saveResult.error.details || '';
        }

        await supabase.from('productions')
          .update({ title: breakdown.title || 'Untitled Script', updated_at: new Date().toISOString() })
          .eq('production_id', production_id);
      } catch (saveErr) {
        console.error('[Slate] Breakdown save failed:', saveErr.message);
        breakdown.save_error = saveErr.message;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify(breakdown) };

  } catch (error) {
    console.error('[FATAL] Breakdown crash:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to process script: ' + error.message }) };
  }
};
