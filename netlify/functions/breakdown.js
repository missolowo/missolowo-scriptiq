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
// The free signup grant. Imported, never written here: this file creates the
// user row, and lib/slate-pricing is what the homepage advertises through the
// pricing endpoint. Two copies meant we could change the advertised number
// and still hand out the old one, silently.
const { SIGNUP_FREE_CREDITS } = require('./lib/slate-pricing');

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

// ── Recording what happened to a production ──
// A production row used to be created at 'processing' on the first chunk and
// only ever moved to 'completed' deep inside the credit-charging branch. That
// branch is skipped for admins and for a production already charged, so those
// runs stayed at 'processing' for ever — 86 of them on one admin account,
// which made the product look far less reliable than it is. A failed run was
// indistinguishable from an abandoned one for the same reason.
//
// Status is now written on every outcome, by this one function, so the table
// says what actually happened.
async function slateMarkProduction(supabase, productionId, userId, patch) {
  if (!supabase || !productionId) return;
  try {
    await supabase.from('productions')
      .upsert(Object.assign(
        { production_id: productionId, updated_at: new Date().toISOString() },
        userId ? { user_id: userId } : {},
        patch
      ), { onConflict: 'production_id' });
  } catch (e) {
    // Bookkeeping must never take down a breakdown the filmmaker has paid for.
    console.error('[Slate] Could not update production status:', e.message);
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

  // Hoisted so the catch block below can mark the production failed. Without
  // these, a crash left the row at 'processing' and the filmmaker saw a
  // production in their list that could never be opened or explained.
  let errSupabase = null;
  let errProductionId = null;
  let errUserId = null;

  try {
    const {
      script, language, user_email, user_id,
      chunk_index, total_chunks, production_id, retry_english
    } = JSON.parse(event.body);
    errProductionId = production_id || null;

    if (!script || script.trim().length < 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No script provided' }) };
    }

    const isAdmin       = ADMIN_EMAILS.includes(user_email);
    const totalChunks   = total_chunks || 1;
    const chunkIndex    = chunk_index || 0;
    const isFirstChunk  = chunkIndex === 0;
    const isLastChunk   = chunkIndex === (totalChunks - 1);
    const supabase      = createClient(SUPABASE_URL, SUPABASE_SECRET);
    errSupabase = supabase;

    // ── Rate limit — only on first chunk so multi-chunk jobs aren't self-blocked ──
    if (!isAdmin && isFirstChunk) {
      const clientIP = getClientIP(event);
      // Twenty an hour, per account — not five.
      //
      // The counter increments on every ATTEMPT, before any work happens, so
      // a failed run costs an attempt while charging no credit. A filmmaker
      // on a weak connection could be locked out for an hour having received
      // nothing, with unused credits sitting in their account — which is
      // very nearly what happened to a Founding Tester whose runs kept
      // failing: four attempts used, three credits untouched, one more and
      // she would have been shut out.
      //
      // It is also per ACCOUNT, not per address (see the key below), so this
      // never limits how many people can use Slate at once. It limits how
      // fast one of them can go, which is what protects us: the credit is
      // only charged when the LAST section finishes, so abandoned runs cost
      // us AI calls and charge nothing.
      //
      // Twenty is invisible to a filmmaker and immediate to a script.
      const rateLimit = await checkRateLimit(supabase, clientIP, 'breakdown', 20, user_id || null);
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
          .from('users').insert({ email: user_email, role: 'free', credits_remaining: SIGNUP_FREE_CREDITS })
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
    // script_language is recorded here because the filmmaker's choice arrives
    // on every chunk but was never stored, leaving the column null on every
    // production ever created. Without it there is no way to know which
    // languages are actually being used, which is the only sensible way to
    // decide which of the languages we claim to support get verified first.
    // Output is always English by PM ruling, so it is recorded as a fact.
    if (isFirstChunk && production_id && user) {
      errUserId = user.id;
      await supabase.from('productions')
        .upsert({
          production_id,
          user_id: user.id,
          status: 'processing',
          script_language: (language && language !== 'auto') ? language : null,
          output_language: 'English',
          created_at: new Date().toISOString()
        }, { onConflict: 'production_id', ignoreDuplicates: true });
    } else if (user) {
      errUserId = user.id;
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

    // ── Second attempt at a section that came back in the source language ──
    // The workspace checks the answer and asks again when a whole section
    // drifts. Repeating the identical request would mostly reproduce the
    // identical answer, so the instruction is sharpened and the temperature
    // dropped to zero for the retry. This text is deliberately blunt: the
    // polite version is already in the prompt and it did not hold.
    const retryNote = retry_english
      ? '\n\nCRITICAL — YOUR PREVIOUS ANSWER FOR THIS SECTION WAS REJECTED.\n'
        + 'You returned the scene descriptions in the screenplay\'s own language. '
        + 'That is wrong and it is the single most important rule in this task. '
        + 'EVERY description, location, set, prop, costume, equipment and note '
        + 'must be written in ENGLISH. Read the original, understand it, and '
        + 'then WRITE IT IN ENGLISH. Do not copy, quote or paraphrase the '
        + 'screenplay in its own language anywhere in your answer. '
        + 'Character names are the only thing copied exactly as written.\n'
      : '';

      const prompt = `You are a professional film script breakdown supervisor. ${sectionNote}${retryNote}Analyze the following screenplay and extract ALL production elements.
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

LOCATION vs SET — read these from the HEADING ONLY:
The heading is the only source. Never infer a location from dialogue, action or who appears in the scene. If the heading says ABAKE'S SITTING ROOM, the location is Abake's House — even if the characters spend the scene discussing Baale.

- "location" is the place the crew TRAVELS TO: a building, compound or area. This becomes the call sheet address.
- "set" is the specific space INSIDE that location where the scene is shot.

How to split a heading:
- "ABAKE'S SITTING ROOM" → location "Abake's House", set "Sitting Room". The possessive names the building; the room is the set.
- "BAALE'S SITTING ROOM" → location "Baale's House", set "Sitting Room". Same rule, different owner.
- "BAALE'S HOUSE" → location "Baale's House", set "Baale's House". No room named, so repeat it.
- "HARMONY COURT. HALLWAY" → location "Harmony Court", set "Hallway". Some scripts already split with a period; use it.
- "BUS-STOP" → location "Bus-Stop", set "Bus-Stop".

Every room belonging to the same owner shares ONE location, so the whole building shoots in one visit. "Abake's Sitting Room", "Abake's Kitchen" and "Abake's House" are all location "Abake's House".

COPY NAMES EXACTLY. "ABE IGI" stays "Abe Igi" — do not translate it to "Under the Tree". Location and set names are proper nouns, like character names. Fix only capitalisation.

BACKGROUND ACTORS:
Background actors are performers with no name and no dialogue who populate a scene — passersby, villagers, market traders, mourners, guests, commuters, a crowd.
- Put them in "background" as a short description in the script's own terms: "Passersby", "Villagers at the coronation", "Market traders".
- Leave "background" empty when a scene has none.
- NEVER estimate a number. Only record a count in "background_count" if the script itself states one, e.g. "about twenty villagers". Otherwise leave it null.
- How many background actors a scene needs is a decision for the producer and director based on budget and location. Our job is to say WHERE background is needed and WHAT KIND, never how many.
- Named characters with dialogue are cast, not background. Do not list them twice.

COSTUME, PROPS AND EQUIPMENT — record only what the script actually specifies:
- Costume means a garment the script describes: "bright yellow wrapper", "police uniform", "torn school shirt".
- Never write a placeholder. "Costume for Adewale", "Adewale's outfit" or "regular clothes" say nothing a costume department can act on, and they make a breakdown look padded.
- If the script does not describe what a character wears, leave costume empty. An empty field is honest; a filler entry wastes a department's time.
- Props and equipment: list every object the script mentions by name — "phone", "makeshift stall", "15,000 naira". Only avoid entries that name no object, such as "props for the scene".
DEPARTMENT CATEGORIES — the same rule, applied harder. These five book crew, hire suppliers and trigger insurance, so a wrong entry costs real money and a missing one is found on the day:
- stunts: a fight, a fall, a chase, a crash — anything a performer could be hurt doing. "Shina shoves Kunle against the wall" is a stunt. Two people arguing is not.
- vehicles: a vehicle the script puts on screen — "danfo bus", "black Hilux", "okada". Not a vehicle merely mentioned in dialogue.
- animals: an animal that appears — "goat", "two chickens". Not an animal mentioned in dialogue or in a proverb.
- special_effects: a practical effect the script calls for — rain, smoke, fire, a gunshot, breaking glass. Not an edit or a camera move.
- makeup_hair: special makeup or hair only — blood, a scar, bruising, ageing, a wig the script names. Everyday grooming is not a breakdown item.
- Leave every one of these empty unless the script says so on the page. Inventing a stunt books a stunt coordinator nobody needs; missing one puts a performer at risk. An empty list is the correct answer for most scenes.
SCREENPLAY:
${script.trim()}

REMINDER: write every description, location, set, prop, costume, equipment, stunt, vehicle, animal, effect and makeup value in ENGLISH, even though the screenplay above may be in another language. Character names stay exactly as written.

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
      "stunts": ["stunt or fight described in the script, in English"],
      "vehicles": ["vehicle named in the script, in English"],
      "animals": ["animal named in the script, in English"],
      "special_effects": ["practical effect the script calls for, in English"],
      "makeup_hair": ["special makeup or hair the script calls for, in English"],
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
    "all_stunts": ["stunt or fight"],
    "all_vehicles": ["vehicle"],
    "all_animals": ["animal"],
    "all_special_effects": ["practical effect"],
    "all_makeup_hair": ["special makeup or hair"],
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
        // Zero on a retry: the first answer broke the one rule that
        // matters, so there is nothing to be gained from variation.
        temperature: retry_english ? 0 : 0.1,
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
      // The run is over and it did not work. Say so on the row, or the
      // filmmaker is left with a production that sits at 'processing' for
      // ever and cannot be opened.
      await slateMarkProduction(supabase, production_id, user ? user.id : null, {
        status: 'failed'
      });
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

        // charged_at is the idempotency record — it is what stops a retry
        // charging a second credit, so it is written only on a real charge.
        await slateMarkProduction(supabase, production_id, user.id, {
          charged_at: new Date().toISOString()
        });

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

    // ── Mark the production finished ──
    // Deliberately OUTSIDE the charging branch above. Completion is a fact
    // about the work, not about the money: an admin run is finished, and so
    // is a retry of a production that was charged the first time. Both used
    // to be left at 'processing' for ever.
    //
    // The title comes from the breakdown because the row is created before
    // the screenplay has been read and so cannot carry one.
    if (isLastChunk && production_id) {
      await slateMarkProduction(supabase, production_id, user ? user.id : null, {
        status: 'completed',
        title: breakdown.title || null,
        script_language: breakdown.language_detected
          || ((language && language !== 'auto') ? language : null),
        output_language: 'English'
      });
    }


    return { statusCode: 200, headers, body: JSON.stringify(breakdown) };

  } catch (error) {
    console.error('[FATAL] Breakdown crash:', error.message);
    // Same reasoning as the OpenAI error path: a crash is an outcome, and
    // the row should record it rather than claiming the work is still
    // running. Uses the hoisted references because the destructured
    // variables are not in scope here.
    await slateMarkProduction(errSupabase, errProductionId, errUserId, { status: 'failed' });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to process script: ' + error.message }) };
  }
};
