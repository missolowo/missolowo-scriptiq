// ============================================
// MISSOLOWO SLATE — STORY DAY FUNCTION
// Netlify Function — Secure Backend
//
// Which day of the STORY each scene happens on. Not which day of the
// shoot — the day in the film's own time, which is what wardrobe, hair
// and continuity match against. Scenes 12 and 48 may shoot three weeks
// apart and still be the same story morning.
//
// ── WHY THIS IS A SEPARATE FUNCTION ──
//
// Every other field on a breakdown is READ off the page. A scene number,
// a location, INT/EXT, a time of day, a prop — the writer wrote it down,
// and "ask the page, don't extend the vocabulary" has been the rule that
// kept this product honest.
//
// A story day is almost never written down. The breakdown prompt asked
// for one under "HEADING METADATA — many scripts put production data in
// the heading", which only takes a story day a writer typed as "(DAY 1)".
// The first live run of THE WEAVER'S DAUGHTER on 24 November came back
// with the field empty on all six scenes, because that script — like most
// screenplays, and nearly every Nollywood one — does not mark them.
//
// So this is the one field where reading the page cannot work. It has to
// be worked out from the narrative, the way a 1st AD does it in ten
// minutes without thinking about it. That makes this function mostly an
// exercise in CONTAINING inference rather than performing it.
//
// It is a separate function so that it cannot touch the breakdown prompt.
// That prompt took three wrong fixes and five real screenplays to get
// right, and both of 23 November's regressions came from changing it.
// Nothing here can reach it.
//
// ── WHAT IT IS ALLOWED TO DO ──
//
// Write one field, on scenes it is given, keyed by scene_index. It cannot
// add a scene, remove one, reorder them, rename a location or touch any
// other value. That is structural rather than a promise: a pass with no
// power to change rows cannot break row conservation.
//
// FREE. Elizabeth's decision, 24 November: a breakdown without continuity
// is incomplete, and that is what shipped. No credit is charged here, and
// a failure costs the filmmaker nothing.
// ============================================
const { slateAuthenticate, isAdmin } = require('./lib/slate-core');
const fetch = (() => {
  try { return require('node-fetch'); }
  catch (e) { return global.fetch; }
})();
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');

const { slateChatBody } = require('./lib/slate-model');
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

// A script that marks its own story days does not need us guessing at
// them. Same shape as slateScriptIsNumbered, and the same reasoning: a
// handful of marks is a writer being inconsistent, a fifth of the script
// is a writer with a convention.
const SLATE_STATED_MIN = 5;
const SLATE_STATED_SHARE = 0.2;

// Enough of the script for the reasoning, and nothing more. No action
// lines, no dialogue — a one-line description is plenty to tell "the next
// morning" from "moments later", and sending the screenplay itself would
// be both slower and a promise we do not need to make.
function slateSceneLine(s) {
  var bits = [];
  bits.push('#' + s.scene_index);
  bits.push(s.scene_label || s.scene_number || '—');
  if (s.scene_type) bits.push('[' + s.scene_type + ']');
  bits.push((s.int_ext || '—') + '.');
  bits.push(s.location || 'location not given');
  bits.push('— ' + (s.time_of_day || 'time not given'));
  var d = String(s.description || '').trim();
  if (d) bits.push(':: ' + d.slice(0, 160));
  return bits.join(' ');
}

exports.handler = async function (event, context) {
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
    const auth = await slateAuthenticate(event);
    if (!auth.ok) {
      return { statusCode: auth.status || 401, headers,
               body: JSON.stringify({ error: auth.error || 'Not signed in' }) };
    }

    // Rate limit AFTER authenticating, keyed on the account and exempting
    // admins — the same shape as schedule and callsheet. The allowance is
    // higher than theirs because this runs once per BREAKDOWN rather than
    // once per document a filmmaker asks for, and a filmmaker re-reading a
    // script they are working on should not hit a wall on a free pass.
    if (!isAdmin(auth.email)) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'storyday', 15, SUPABASE_SECRET, auth.authId || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'storyday');
    }

    const { scenes } = JSON.parse(event.body || '{}');
    if (!Array.isArray(scenes) || !scenes.length) {
      return { statusCode: 400, headers,
               body: JSON.stringify({ error: 'No scenes provided' }) };
    }

    // ── The writer's own marks win, always ──
    //
    // Consistent with every other field in this product. If a writer went
    // to the trouble of marking story days, ours are not an improvement on
    // theirs, and a script that marks enough of them does not call this
    // function at all — no model call, no latency, no cost.
    const stated = scenes.filter(function (s) {
      return String(s.story_day || '').trim();
    }).length;
    if (stated >= SLATE_STATED_MIN && stated >= scenes.length * SLATE_STATED_SHARE) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          skipped: 'script_states_its_own',
          stated: stated,
          story_days: []
        })
      };
    }

    const list = scenes.map(slateSceneLine).join('\n');

    const prompt = `You are reading a complete screenplay's scene list IN SCRIPT ORDER. Work out which DAY OF THE STORY each scene happens on.

A story day is a day in the film's own time. It is NOT the shooting day. Scenes shot weeks apart can be the same story day, and that is exactly what this is for: wardrobe, hair and continuity match scenes that share one.

Number story days 1, 2, 3 in the order they occur in the film. A story day is a whole day, so a scene at night and a scene that morning are the same story day if no new day began between them.

START A NEW STORY DAY when:
- time runs backwards or restarts: a NIGHT scene followed by a MORNING or DAY scene
- the action says time passed: "the next morning", "three weeks later", "ONE YEAR PASSING"
- a montage or sequence that spans time sits between two scenes

DO NOT start a new story day when:
- the heading says CONTINUOUS, MOMENTS LATER, LATER or SAME
- the time of day simply moves forward within one day: MORNING to DAY, DAY to EVENING
- the scene cuts to another place at the same moment (INTERCUT)

FLASHBACKS AND DREAMS ARE NOT ON THE MAIN LINE. A scene marked [FLASHBACK] or [DREAM] happens in another time entirely. Never give it the story day of the scenes around it — a flashback between scene 6 and scene 7 is not story day 7. Return null for it.

"I DO NOT KNOW" IS A CORRECT ANSWER, AND IT IS FREE.
Return null for any scene you cannot place with confidence. This matters more than coverage. A wrong story day tells a wardrobe supervisor that two scenes must match when they must not, and they will plan a costume around it. A null tells them to read the script themselves, which is what they would have done anyway. Never guess to fill the list.

Return null, not a number, for:
- a montage or sequence that spans more than one day — it belongs to no single story day
- a flashback or dream
- any scene where the script gives you nothing to go on

Return ONLY this JSON. One entry per scene, in the order given, using the #index exactly as shown:

{
  "story_days": [
    { "index": 1, "day": 1 },
    { "index": 2, "day": 1 },
    { "index": 3, "day": null },
    { "index": 4, "day": 2 }
  ]
}

THE SCENES:

${list}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(slateChatBody({
        max_tokens: 4000,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a professional Nollywood first assistant director working out story days from a scene list. You answer null whenever you are not sure, because a wrong story day sends a wardrobe supervisor to the wrong conclusion and a null simply sends them to the script.'
          },
          { role: 'user', content: prompt }
        ]
      }))
    });

    if (!response.ok) {
      // Fails safe. The breakdown is never worse for having tried: the
      // caller leaves every scene exactly as it was and Report 5 does not
      // render. Nothing is charged, so there is nothing to refund.
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ failed: 'model_unavailable', story_days: [] })
      };
    }

    const data = await response.json();
    let parsed;
    try { parsed = JSON.parse(data.choices[0].message.content); }
    catch (e) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ failed: 'unreadable_response', story_days: [] })
      };
    }

    // ── Everything below is the containment ──
    //
    // The model answers about scenes; it does not get to decide which
    // scenes exist. Each answer is matched to a scene_index we actually
    // sent, and anything else is dropped rather than questioned.
    const known = {};
    scenes.forEach(function (s) { known[Number(s.scene_index)] = true; });

    const seen = {};
    const out = [];
    (Array.isArray(parsed.story_days) ? parsed.story_days : []).forEach(function (row) {
      const i = Number(row && row.index);
      if (!known[i] || seen[i]) return;
      seen[i] = true;
      // A day is a positive whole number or nothing. "DAY 1", "one" and
      // -3 are all nothing: this field is compared for equality across
      // scenes, so a value that does not compare cleanly is worse than
      // an absent one.
      const d = Number(row.day);
      if (!row.day && row.day !== 0) return;
      if (!isFinite(d) || d < 1 || Math.floor(d) !== d) return;
      out.push({ index: i, day: String(d) });
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        story_days: out,
        // What the caller reports back so the first real run can be read
        // rather than trusted. Counts only.
        scenes_in: scenes.length,
        placed: out.length,
        unknown: scenes.length - out.length,
        distinct: Object.keys(out.reduce(function (a, r) { a[r.day] = 1; return a; }, {})).length
      })
    };

  } catch (error) {
    // Same rule as a model failure: a story-day pass that throws must not
    // be able to cost anyone a breakdown.
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ failed: 'error', story_days: [] })
    };
  }
};
