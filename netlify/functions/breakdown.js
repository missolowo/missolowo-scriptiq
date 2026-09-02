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
      + 'written in. Every scene description, prop, costume and equipment item '
      + 'must be written in English. '
      + 'Do NOT translate names: character names, location names and set names '
      + 'are proper nouns and must be copied EXACTLY as the script writes them. '
      + 'If the script says "Baale\'s House", write "Baale\'s House" — never '
      + '"Chief\'s House". Use the same spelling every time a place appears.';  
    const sectionNote = totalChunks > 1
      ? `This is section ${chunkIndex + 1} of ${totalChunks} of a longer screenplay. `
      : '';

      const prompt = `You are a professional film script breakdown supervisor. ${sectionNote}Analyze the following screenplay and extract ALL production elements.
${langInstruction}

SCENE BOUNDARIES — the most important rule in this task:
A new scene begins ONLY at a scene heading (slug line). A slug line contains INT or EXT (or an equivalent), a location, and usually a time of day, and may be preceded by a scene number.
- NEVER start a new scene because the mood changes, a new character speaks, an argument begins, or a long scene feels like two.
- A scene that runs for pages and covers several emotional beats is still ONE scene.
- NEVER invent a time of day. Copy it from the heading. If two parts of one scene appear to differ, you have wrongly split a single scene.
- The number of scenes you return must equal the number of slug lines in the text.
IGNORE FRONT MATTER:
A script may open with a title page, episode title, writer credits, a cast list, or an episode synopsis. NONE of these are scenes. Extraction begins at the first slug line and nothing before it.
- Never create a scene from a synopsis sentence.
- Never use synopsis wording as a scene description.
- If a section of text contains no slug line, it contains no scenes. Return an empty scenes array for it.

SCENE NUMBERS:
Copy the number from the heading EXACTLY as written, as a string. Examples: "12", "47A", "2.01", "00".
- Do not renumber, do not convert to integers, do not fill gaps, do not correct mistakes.
- If a heading carries no number, use null.
- Crews work from the script's own numbering. Our documents must match their pages.

HEADING METADATA — many scripts put production data in the heading. Use it:
- A parenthesised cast list, e.g. (BIMPE, REX), lists the characters in that scene. When present, USE IT as the cast. Only infer cast from dialogue when the heading gives none.
- A story day, e.g. (DAY 1), goes in story_day.
- (FLASHBACK), (DREAM), (MONTAGE), (INTERCUT) go in scene_type.

LOCATION vs SET — this distinction drives scheduling, so get it right:
- "location" is the place the crew TRAVELS TO: a building, compound or area. This becomes the call sheet address. Example: "Baale's House".
- "set" is the specific space INSIDE that location where the scene is shot. Example: "Sitting Room", "Backyard", "Hallway".
- Some scripts already separate them with a period: "HARMONY COURT. HALLWAY" means location "Harmony Court", set "Hallway". Use that split when it is present rather than guessing.
- A heading like "INT. BAALE'S SITTING ROOM" means location "Baale's House", set "Sitting Room".
- Use the SAME location string for every space in the same building, so the whole building can be shot in one visit.
- If a heading names a place with no interior space, such as "EXT. BUS STOP", repeat the location as the set.

BACKGROUND ACTORS:
Background actors are performers with no name and no dialogue who populate a scene — passersby, villagers, market traders, mourners, guests, commuters, a crowd.
- Put them in "background" as a short description in the script's own terms: "Passersby", "Villagers at the coronation", "Market traders".
- Leave "background" empty when a scene has none.
- NEVER estimate a number. Only record a count in "background_count" if the script itself states one, e.g. "about twenty villagers". Otherwise leave it null.
- How many background actors a scene needs is a decision for the producer and director based on budget and location. Our job is to say WHERE background is needed and WHAT KIND, never how many.
- Named characters with dialogue are cast, not background. Do not list them twice.
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
      "scene_number": "2.01",
      "scene_type": "",
      "story_day": "",
      "int_ext": "INT",
      "time_of_day": "NIGHT",
      "location": "Travel destination, in English",
      "set": "Space within that location, in English",
      "description": "One sentence summary, in English",
      "cast": ["Character Name"],
      "background": "",
      "background_count": null,
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


    return { statusCode: 200, headers, body: JSON.stringify(breakdown) };

  } catch (error) {
    console.error('[FATAL] Breakdown crash:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to process script: ' + error.message }) };
  }
};
