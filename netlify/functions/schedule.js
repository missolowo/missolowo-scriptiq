// ============================================
// MISSOLOWO SLATE — SHOOTING SCHEDULE FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Takes breakdown data and generates shooting schedule
// Columns: Day | Date | Location | Scene No | Cast Required | INT/EXT | Props
// ============================================
const { createClient } = require('@supabase/supabase-js');
const fetch = (() => {
  try { return require('node-fetch'); }
  catch(e) { return global.fetch; }
})();
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');
// One definition of name matching, scene sorting and the admin list.
// See lib/slate-core.js — mirrored in app.html, change both together.
const { isAdmin, slateKey, slateTitleCase, bySceneNumberField } = require('./lib/slate-core');
// A DISPLAY helper must never be able to take down a paid feature. If an
// older copy of slate-core is still in the deployed bundle — which happens
// when a shared module and the function using it land in separate commits —
// names simply print as the script wrote them instead of the schedule
// failing with a 500 and costing the filmmaker their credit.
const slateName = (typeof slateTitleCase === 'function') ? slateTitleCase : function (n) { return n; };

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

    const isAdminEmail = isAdmin(user_email);

    // ── STEP 1: Rate limit — user_id passed to fix the film-set shared-IP issue ──
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'schedule', 5, SUPABASE_SECRET, user_id || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'schedule');
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Single-pass user verification ──
    let user = null;
    if (user_id || user_email) {
      const query = user_id
        ? supabase.from('users').select('*').eq('id', user_id).single()
        : supabase.from('users').select('*').eq('email', user_email).single();
      const { data } = await query;
      user = data;
    }

    // ── STEP 3b: Core access guard ──
    // No credit check here, deliberately. The breakdown is the paywall: one
    // credit buys a complete job, and the schedule is part of that job.
    //
    // Blocking on a zero balance broke the promise from the other end. A
    // filmmaker with one credit ran their breakdown, which spent it, and was
    // then told "No credits remaining" when they asked for the schedule they
    // had just paid for — the last step of the job they bought, refused.
    //
    // A schedule cannot be built without a breakdown to build it from, and
    // that breakdown was already paid for, so there is nothing here to
    // protect. The call sheet has never charged or gated for the same
    // reason. is_disabled still applies: that is an account state, not a
    // balance.
    if (user && !isAdminEmail) {
      if (user.is_disabled) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Account disabled. Contact support.' }) };
      }
    }

    // ── STEP 4: Slim the scenes ──
    // Scheduling only needs scene identity, location, timing and cast.
    // Sending full descriptions/props/costume blew the function timeout.
       const slimScenes = (breakdown.scenes || []).map(function (s, i) {
      return {
        // Permanent identity — carried through so the call sheet can match
        // scenes by identity instead of by number. Falls back to array
        // position for breakdowns saved before scene_index existed.
        idx: s.scene_index || (i + 1),
        n: (s.scene_number === null || s.scene_number === undefined || s.scene_number === 'null') ? null : s.scene_number,
        ie: s.int_ext || 'INT',
        tod: s.time_of_day || 'DAY',
        loc: s.location || s.set_location || '',
        set: s.set || '',
        // Page length, measured off the script at split time. A day's total
        // is how a production manager judges whether the day is achievable,
        // so it has to travel with the scene.
        eighths: Number(s.slate_eighths) || 0,
        cast: (s.cast || []).slice(0, 8),
        // Flagged, never counted — how many is a producer decision.
        bg: Array.isArray(s.background) ? s.background.join(', ') : (s.background || '')
      };
    });

    // ── STEP 5: Build the schedule in CODE — deterministic, instant, no timeout ──
    // The AI only adds production notes afterwards. Grouping scenes by
    // location is arithmetic, not judgement, so code does it reliably.
    let schedule;
    try {
      const dayCount = Math.max(1, parseInt(shoot_days, 10) || 10);

      // Matching key only — never displayed. Now the shared implementation:
      // the local copy stripped to A-Z, so every Korean, Russian, Arabic,
      // Hindi and Chinese name and location normalised to an empty string
      // and collapsed into one another.
      const normKey = slateKey;

      // ── One key for "is this the same place?" ──
      // slateKey keeps spaces, so the model writing a Yorùbá name two ways —
      // "Ìdí Ọ̀GÁN" and "Ìdí Ọ̀ GÁN" — produced two different places. Scene 1
      // was grouped away from scenes 5, 7, 9 and 11 at that same location,
      // and across a longer script the two spellings can land on different
      // SHOOT DAYS: two trips to one place.
      //
      // Joining without spaces is the convention slateLocationKey already
      // uses in the breakdown, which is why Report 3 groups these correctly
      // while the schedule did not. This belongs in lib/slate-core.js beside
      // slateKey so there is one implementation; it is here only because that
      // file is not in hand.
      function slatePlaceKey(v) {
        return normKey(String(v == null ? '' : v)).replace(/\s+/g, '');
      }

      // ── Scenes the screenplay never placed ──
      // These used to be grouped like everywhere else. Every one of them
      // shares the empty location key, so they formed a single large group —
      // and "largest groups first", which is right for real locations, then
      // sorted that group to the FRONT. The filmmaker's day 1 call sheet was
      // therefore the emptiest document the product could produce: on LORI
      // NKAN MI, nine scenes with no location, no set and mostly no cast.
      //
      // A 1st AD does not put a scene with no location on a call sheet; they
      // flag it and chase the writer. So these leave the day structure
      // entirely and are reported on their own, where a producer can act on
      // them. Nothing is dropped — slateUnplaced + the scheduled scenes
      // always add back up to the total, and the cover prints that sum.
      function slateIsUnplaced(s) {
        var loc = String(s.loc || '').trim();
        if (loc === 'null' || loc === 'undefined' || loc === 'Unspecified') loc = '';
        return !loc && !String(s.set || '').trim();
      }
      const slateUnplaced = slimScenes.filter(slateIsUnplaced);
      const slatePlaced = slimScenes.filter(function (s) { return !slateIsUnplaced(s); });

      // Group scenes by location, keeping day and night separate
      const groups = {};
      slatePlaced.forEach(function (s) {
        var loc = String(s.loc || '').trim();
        if (loc === 'null' || loc === 'undefined' || loc === 'Unspecified') loc = '';
        // slatePlaceKey, not normKey — see the note above. Two spellings of
        // one location must not become two groups, or they become two trips.
        const key = slatePlaceKey(loc) + '|' + (String(s.tod).toUpperCase().indexOf('NIGHT') >= 0 ? 'N' : 'D');
        if (!groups[key]) groups[key] = { location: loc, night: key.endsWith('|N'), scenes: [] };
        groups[key].scenes.push(s);
      });
      // Largest groups first so big locations aren't split across days
      const ordered = Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return b.scenes.length - a.scenes.length; });

      // Distribute into shoot days.
      // A day records EVERY location it contains, not just the first —
      // otherwise the call sheet prints one address while listing scenes
      // shot somewhere else, and crew go to the wrong place.
      const perDay = Math.ceil(slatePlaced.length / dayCount) || 1;
      const days = [];
      let current = { scenes: [], locations: [] };

      function closeDay() {
        if (current.scenes.length) days.push(current);
        current = { scenes: [], locations: [] };
      }

    
      // Split each location into evenly-sized pieces first. A location with
      // 12 scenes and a 9-per-day limit becomes 6 and 6, not 9 and 3 — a
      // three-scene day still costs a full crew, so an even spread is both
      // cheaper and more realistic to shoot.
      var pieces = [];
      ordered.forEach(function (g) {
        var needed = Math.max(1, Math.ceil(g.scenes.length / perDay));
        var size = Math.ceil(g.scenes.length / needed);
        for (var i = 0; i < g.scenes.length; i += size) {
          pieces.push({ location: g.location, scenes: g.scenes.slice(i, i + size) });
        }
      });

       // Pack pieces into days, so small locations share rather than each
      // taking a day to itself.
      var overflow = [];
      pieces.forEach(function (p) {
        // Once every day is spoken for, hold the rest back rather than
        // dumping them all into the final day — twenty scenes across
        // seventeen locations is not a day anyone can shoot.
        if (days.length >= dayCount - 1 && current.scenes.length + p.scenes.length > perDay) {
          overflow.push(p);
          return;
        }
        if (current.scenes.length &&
            current.scenes.length + p.scenes.length > perDay &&
            days.length < dayCount - 1) {
          closeDay();
        }
        if (p.location && current.locations.indexOf(p.location) < 0) current.locations.push(p.location); 
        p.scenes.forEach(function (s) { current.scenes.push(s); });
      });
      closeDay();

      // Place whatever is left. Prefer a day already going to that location —
      // returning to a place you have wrapped means travelling back, which is
      // the cost the whole grouping exists to avoid. Only when no such day
      // exists does it go to the emptiest one.
      overflow.forEach(function (p) {
        if (!days.length) {
        days.push({ scenes: p.scenes.slice(), locations: p.location ? [p.location] : [] }); 
          return;
        }
        var sameLocation = days.filter(function (d) {
          return d.locations.indexOf(p.location) >= 0;
        });
        var pool = sameLocation.length ? sameLocation : days;
        var target = pool.reduce(function (a, b) {
          return a.scenes.length <= b.scenes.length ? a : b;
        });
      if (p.location && target.locations.indexOf(p.location) < 0) target.locations.push(p.location);
        p.scenes.forEach(function (s) { target.scenes.push(s); });
      });
      // ── Shooting order within a day ──
      // This used to sort by scene number, which is SCRIPT order, not
      // shooting order. It produced days like "D N D N D D D N D D": an
      // exterior night scene scheduled second in the morning, and the same
      // bedroom lit, struck, and lit again three times in one day.
      //
      // The rules, from the production side:
      //   1. Every DAY scene before every NIGHT scene. Nights go at the end.
      //   2. Inside each block, every scene at one place is shot together —
      //      one company move per place, not one per scene.
      //   3. Order the places so an actor already working carries over to
      //      the next place rather than being released and recalled.
      //   4. Inside a place, ascending scene number.
      function slateIsNight(s) {
        return String(s.tod || '').toUpperCase().indexOf('NIGHT') >= 0;
      }
      // The SET is the room the crew lights; the location is the building.
      // Grouping on the set is what keeps the bedroom scenes together.
      function slatePlaceOf(s) {
        return slatePlaceKey(s.set || s.loc || '') || '\u0000noplace';
      }
      function slateOrderBlock(list) {
        var byPlace = {}, places = [];
        list.forEach(function (s) {
          var k = slatePlaceOf(s);
          if (!byPlace[k]) { byPlace[k] = { scenes: [], cast: {} }; places.push(byPlace[k]); }
          byPlace[k].scenes.push(s);
          (s.cast || []).forEach(function (c) {
            var ck = normKey(c);
            if (ck) byPlace[k].cast[ck] = true;
          });
        });
        places.forEach(function (p) { p.scenes.sort(bySceneNumberField('n')); });
        // Biggest place first, then repeatedly whichever shares the most cast
        // with the place just finished — that is "hold the actor to the next
        // location" expressed as an ordering.
        var pool = places.slice().sort(function (a, b) { return b.scenes.length - a.scenes.length; });
        var out = [], cur = pool.shift();
        while (cur) {
          out.push(cur);
          if (!pool.length) break;
          var best = null, bestShared = -1;
          pool.forEach(function (p) {
            var shared = 0;
            Object.keys(p.cast).forEach(function (c) { if (cur.cast[c]) shared++; });
            if (shared > bestShared ||
                (shared === bestShared && best && p.scenes.length > best.scenes.length)) {
              bestShared = shared; best = p;
            }
          });
          pool.splice(pool.indexOf(best), 1);
          cur = best;
        }
        var flat = [];
        out.forEach(function (p) { p.scenes.forEach(function (s) { flat.push(s); }); });
        return flat;
      }
      days.forEach(function (d) {
        var dayPart = d.scenes.filter(function (s) { return !slateIsNight(s); });
        var nightPart = d.scenes.filter(slateIsNight);
        d.scenes = slateOrderBlock(dayPart).concat(slateOrderBlock(nightPart));
      });

      // Dates
      function addDays(dateStr, n) {
        var d;
        try { d = new Date(String(dateStr || '').replace(/^[A-Za-z]+\s+/, '')); } catch (e) { return ''; }
        if (!d || isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + n);
        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      const baseDate = start_date || 'Monday 30 June 2026';
      // Count distinct scene numbers. A script with a duplicate — two
      // different scenes both numbered 67 — would otherwise report one
      // more scene than the breakdown found.
      // Count by identity, not by number. Counting by scene_number collapsed
      // every unnumbered scene into a single "null" entry, so a script with
      // five unnumbered scenes reported four fewer than it has.
      var uniqueScenes = {};
      slimScenes.forEach(function (s) { uniqueScenes[String(s.idx)] = true; });
      // Warn when a day carries more locations than a crew could realistically
      // move between. We do not silently produce an impossible day.
      var crowdedDays = days.filter(function (d) { return d.locations.length > 3; }).length;
      
      schedule = {
        title: breakdown.title || 'Untitled Production',
        total_shoot_days: days.length,
        total_scenes: Object.keys(uniqueScenes).length,
        schedule_warning: crowdedDays
          ? crowdedDays + ' day' + (crowdedDays > 1 ? 's have' : ' has') + ' more than three locations. Consider adding shoot days — company moves cost time and money.'
          : '',
        schedule: days.map(function (d, i) {
          // How many of this day's scenes have no location in the script.
          // A blank location is correctly kept OUT of the day header — but
          // the SCENES still land in the day, so a day could read
          // "DAY 01 · IGI ODAN" while seven of its nine scenes belong
          // nowhere near Igi Odan. A crew reads that header and drives.
          var unplaced = d.scenes.filter(function (s) {
            return !String(s.loc || '').trim();
          }).length;
          return {
            day: i + 1,
            date: addDays(baseDate, i) || baseDate,
            location: d.locations.join(' · '),
            locations: d.locations.slice(),
            // Counted and reported, never hidden. The documents that read
            // this can say so plainly instead of implying a place.
            scenes_without_location: unplaced,
            company_move: d.locations.length > 1,
           scenes: d.scenes.map(function (s) {
              return {
                scene_index: s.idx,
                scene_number: s.n,
                int_ext: s.ie,         
                time_of_day: s.tod,
                set: s.set || '',
                description: '',
                eighths: s.eighths || 0,
                cast_required: s.cast || [],
                background: s.bg || '',
                props: []
              };
            }),
            production_notes: ''
          };
        }),
        cast_release_schedule: [],

        // ── Scenes that could not be scheduled ──
        // Reported, never silently dropped. scenes_scheduled + the length of
        // this list always equals total_scenes, and the cover prints that sum
        // so a shorter schedule never reads as missing scenes.
        scenes_scheduled: slatePlaced.length,
        unscheduled_reason: slateUnplaced.length
          ? 'The screenplay never states a location for these scenes, so they cannot be placed on a shoot day yet.'
          : '',
        unscheduled_scenes: slateUnplaced.map(function (s) {
          return {
            scene_index: s.idx,
            scene_number: s.n,
            int_ext: s.ie,
            time_of_day: s.tod,
            cast_required: s.cast || [],
            background: s.bg || ''
          };
        })
      };

      // Cast numbers, assigned in the breakdown, looked up here so the
      // release schedule and the Day Out of Days use the same number the
      // breakdown printed. Keyed the same way the breakdown keyed them.
      const slateCastNo = {};
      (breakdown.character_breakdown || []).forEach(function (c) {
        if (c && c.character && c.cast_number) slateCastNo[normKey(c.character)] = c.cast_number;
      });

      // Cast release — derived in code
      const castDays = {};
      schedule.schedule.forEach(function (d) {
        d.scenes.forEach(function (s) {
          (s.cast_required || []).forEach(function (c) {
            const k = normKey(c);
            if (!castDays[k]) castDays[k] = { character: c, days_required: [] };
            if (castDays[k].days_required.indexOf(d.day) < 0) castDays[k].days_required.push(d.day);
          });
        });
      });
      // An actor who appears ONLY in unplaceable scenes has no shoot day, so
      // the loop above never sees them and they vanish from the cast release
      // entirely — the one person a producer most needs to know about, because
      // nobody can tell them when they are working. Carry them through with no
      // days and a flag instead of dropping them.
      const castUnplaced = {};
      slateUnplaced.forEach(function (s) {
        (s.cast || []).forEach(function (c) {
          const k = normKey(c);
          if (!castDays[k] && !castUnplaced[k]) castUnplaced[k] = { character: c };
        });
      });

      schedule.cast_release_schedule = Object.keys(castDays).map(function (k) {
        const c = castDays[k];
        var dr = c.days_required.length ? c.days_required : [1];
        return { character: slateName(c.character), cast_number: slateCastNo[k] || null,
                 days_required: dr, release_day: Math.max.apply(null, dr) };
      }).concat(Object.keys(castUnplaced).map(function (k) {
        return {
          character: slateName(castUnplaced[k].character),
          cast_number: slateCastNo[k] || null,
          days_required: [],
          release_day: null,
          unscheduled_only: true
        };
      })).sort(function (a, b) {
        // Cast order, not discovery order — a production reads this list by
        // number, and number 1 is the actor whose availability drives the
        // whole schedule.
        var an = a.cast_number || 9999, bn = b.cast_number || 9999;
        if (an !== bn) return an - bn;
        return String(a.character).localeCompare(String(b.character));
      });

      // ── Small AI pass for production notes only — fails safe ──
      try {
        // scenes_without_location is sent, and the instruction says what to
        // do about it. Without it the model was told only "day 1, location
        // Igi Odan, 9 scenes" and wrote "All scenes to be shot in Igi Odan"
        // for a day where seven scenes have no location in the script at
        // all. A production note that names the wrong place is worse than
        // no note: a crew acts on it.
        const notePrompt = 'You are a Nollywood production manager. For each shoot day below, write one short production note (logistics, moves, night-shoot warnings).\n'
          + 'IMPORTANT: scenes_without_location is the number of scenes that day whose location the screenplay never states. '
          + 'NEVER write that all scenes are at a named location when scenes_without_location is above zero — say instead that '
          + 'those scenes still need a location before the day can be planned. If scenes_without_location is 0, do not mention it.\n'
          + 'Return JSON: {"notes":[{"day":1,"note":"..."}]}\n\n'
          + JSON.stringify(schedule.schedule.map(function (d) {
              return {
                day: d.day,
                location: d.location,
                scenes: d.scenes.length,
                scenes_without_location: d.scenes_without_location,
                night: d.scenes.filter(function (s) { return String(s.time_of_day).toUpperCase().indexOf('NIGHT') >= 0; }).length
              };
            }));

        const noteRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1200,
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: notePrompt }]
          })
        });

        if (noteRes.ok) {
          const noteData = await noteRes.json();
          const parsed = JSON.parse(noteData.choices?.[0]?.message?.content || '{}');
          (parsed.notes || []).forEach(function (n) {
            const target = schedule.schedule.find(function (d) { return d.day === n.day; });
            if (target) target.production_notes = n.note || '';
          });
        }
      } catch (e) {
        console.warn('[Slate] Production notes unavailable:', e.message);
      }

    } catch (buildErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Could not build the schedule: ' + buildErr.message,
          where: (buildErr.stack || '').split('\n').slice(0, 3).join(' | ')
        })
      };
    }

    // ── STEP 6: Report the balance. The schedule costs nothing. ──
    // One credit buys a COMPLETE job — breakdown, schedule and call sheet —
    // which is what the pricing page sells. This used to deduct a second
    // credit, so a filmmaker who ran a breakdown and then its schedule spent
    // two for what they had been sold as one: three free credits bought one
    // and a half complete jobs, and a Starter pack two and a half rather
    // than five. The call sheet never charged, so the breakdown is now the
    // single point where a job is paid for.
    if (user) {
      schedule.credits_remaining = user.credits_remaining;
      schedule.user_role = user.role;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(schedule)
    };

  } catch (error) {
    console.error('[CISO Fatal Catch] Schedule processing crash:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to generate schedule: ' + error.message,
        where: (error.stack || '').split('\n')[1] || ''
      })
    };
  }
};
