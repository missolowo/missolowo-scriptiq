// ============================================
// MISSOLOWO SLATE — SHOOTING SCHEDULE FUNCTION
// Netlify Function — Secure Backend (CISO Hardened)
// Takes breakdown data and generates shooting schedule
// Columns: Day | Date | Location | Scene No | Cast Required | INT/EXT | Props
// ============================================
const { createClient } = require('@supabase/supabase-js');
const { slateAuthenticate } = require('./lib/slate-core');
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
  // slateKey directly, not the handler's local `normKey` alias — this
  // function now lives at module scope and that alias is not in scope here.
  return slateKey(String(v == null ? '' : v)).replace(/\s+/g, '');
}

// ── Deriving a schedule from an assignment ──
// Everything below follows from ONE fact: which scenes sit on which day.
// Shooting order, each day's locations and header, company moves, page
// counts, dates, and the cast release schedule are all consequences of
// that assignment rather than independent data.
//
// It lives apart from the code that PRODUCES an assignment because there
// is now more than one way to produce one. Today the packer below groups
// by location and spreads across the requested days. Next a production
// manager moves a scene because an actor is unavailable, and later a
// scheduler reads cast availability and assigns around it. All three must
// derive the same way, or a hand-moved scene gets a cast release computed
// by different rules than a generated one — and an actor released a day
// before they are called is a mistake a crew acts on.
function slateDeriveSchedule(days, breakdown, slimScenes, slatePlaced, slateUnplaced, start_date) {
      const normKey = slateKey;

      // ── A day's locations are its scenes' locations. Always recomputed. ──
      // The packer happens to track these as it fills each day, and for a
      // freshly generated schedule its answer and this one agree. But the
      // moment a scene moves day — by hand, or by a scheduler working
      // around an actor's dates — a list carried over from the packer is
      // describing where the scenes USED to be.
      //
      // That list is the day header. It is the address a crew reads and
      // drives to. So it is derived here from what is actually on the day,
      // and nothing upstream is trusted to have kept it current.
      //
      // Deduplicated on the place key rather than the raw string, for the
      // same reason the packer groups on it: one location spelled two ways
      // is one place, and printing both would read as two.
      days.forEach(function (d) {
        var seen = {}, locs = [];
        (d.scenes || []).forEach(function (s) {
          var loc = String((s && s.loc) || '').trim();
          if (loc === 'null' || loc === 'undefined' || loc === 'Unspecified') loc = '';
          if (!loc) return;
          var k = slatePlaceKey(loc);
          if (seen[k]) return;
          seen[k] = true;
          locs.push(loc);
        });
        d.locations = locs;
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
        // A scene with no location NEVER leads a day.
        //
        // This is the whole of what went wrong before. Such scenes all
        // share the empty place key, so they formed one large group, and
        // "largest group first" — right for real locations — sorted it to
        // the front. LORI NKAN MI's day 1 call sheet opened with nine
        // scenes that had no location, no set and mostly no cast.
        //
        // The answer then was to take them out of the days altogether,
        // which meant they could never reach a call sheet at all. They are
        // scenes in the film; somebody still has to shoot them. So they go
        // last, where they read as what they are: work to place.
        var slateHasPlace = function (sc) {
          return !!String(sc.loc || sc.set || '').trim();
        };
        d.scenes = d.scenes.filter(slateHasPlace)
          .concat(d.scenes.filter(function (sc) { return !slateHasPlace(sc); }));
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
      
      var schedule = {
        title: breakdown.title || 'Untitled Production',
        // ── Which breakdown run this schedule was built from ──
        // Echoed, never minted here. A schedule has no identity of its own:
        // it is a reading of one breakdown, and the only useful thing it can
        // say about itself is which breakdown that was. The call sheet then
        // checks this against the breakdown it is handed, which is the
        // comparison nothing was doing when a call sheet from one run was
        // printed beside a schedule from another.
        slate_run_id: breakdown.slate_run_id || '',
        slate_run_at: breakdown.slate_run_at || '',
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

          // ── Where a compromise shoot might save waiting for dark ──
          // We shoot every day scene before every night scene, so a
          // location with both on one day means the unit sits at a set
          // they are already on, waiting for the light to go.
          //
          // A production manager raised this: sometimes that night work
          // can be covered during the day with the director and the DP's
          // agreement. Sometimes it cannot, and sometimes a compromise
          // has already been agreed in a room Slate knows nothing about.
          //
          // So this is REPORTED and never acted on. Nothing is reordered,
          // and a night scene stays marked NIGHT — the label describes
          // what the scene is, not when it happened to be shot. He asked
          // for it that way, and he is the one who has to defend the
          // schedule to a crew.
          var byPlace = {};
          d.scenes.forEach(function (s) {
            var loc = String(s.loc || '').trim();
            if (!loc) return;
            var k = slatePlaceKey(loc);
            if (!byPlace[k]) byPlace[k] = { location: loc, day: 0, night: [] };
            if (slateIsNight(s)) byPlace[k].night.push(s.n);
            else byPlace[k].day++;
          });
          var compromises = Object.keys(byPlace).map(function (k) { return byPlace[k]; })
            .filter(function (p) { return p.day > 0 && p.night.length > 0; })
            .map(function (p) {
              return { location: p.location, night_scenes: p.night.slice() };
            });

          return {
            day: i + 1,
            date: addDays(baseDate, i) || baseDate,
            location: d.locations.join(' · '),
            locations: d.locations.slice(),
            // Counted and reported, never hidden. The documents that read
            // this can say so plainly instead of implying a place.
            scenes_without_location: unplaced,
            company_move: d.locations.length > 1,
            // Opportunities, not instructions. Nothing above has moved.
            compromise_shoots: compromises,
            // ── Which story days this shoot day touches ──
            //
            // A shoot day is assembled by location, so it routinely holds
            // scenes from several different days of the STORY. That is
            // normal and not a fault — but it is exactly when wardrobe and
            // hair have to plan a change mid-day, and nothing told them.
            //
            // Distinct values in the order they appear on the day, so a
            // reader sees both how many changes the day needs and which
            // way round they run. Reported; nothing is reordered.
            story_days: (function () {
              var seen = {}, out = [];
              d.scenes.forEach(function (s) {
                var sd = String(s.sd || '').trim();
                if (!sd || seen[sd]) return;
                seen[sd] = true;
                out.push(sd);
              });
              return out;
            })(),
           scenes: d.scenes.map(function (s) {
              return {
                scene_index: s.idx,
                scene_number: s.n,
                int_ext: s.ie,
                time_of_day: s.tod,
                set: s.set || '',
                // The place, as distinct from the set — a bedroom and a
                // courtyard are two sets at one location. The workspace
                // needs it per scene to offer "move the rest of this
                // location too", which it cannot get from the day header
                // once a day holds more than one place.
                location: s.loc || '',
                description: '',
                eighths: s.eighths || 0,
                story_day: s.sd || '',
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
        // These scenes ARE on a shoot day and on its call sheet — listed
        // here as well because a producer needs to chase the writer for a
        // location before the day arrives, not discover it on the morning.
        unscheduled_reason: slateUnplaced.length
          ? 'The screenplay never states a location for these scenes. They are scheduled at the end of their day so nothing is lost, but each one needs a location confirmed before that day is shot.'
          : '',
        unscheduled_scenes: slateUnplaced.map(function (s) {
          return {
            scene_index: s.idx,
            scene_number: s.n,
            int_ext: s.ie,
            time_of_day: s.tod,
            story_day: s.sd || '',
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

      return schedule;
}

// ── Deciding an assignment: which scenes go on which day ──
// The default way. Group by location so a place is visited once, split
// each group evenly rather than filling days to the brim, and hold back
// what will not fit instead of dumping it all on the last day.
//
// This is ONE way to produce an assignment. slateDaysFromAssignment is
// another, for when a production manager knows something the screenplay
// does not — that an actor is only free on Thursday. Both hand the same
// shape to slateDeriveSchedule, which is what stops a hand-moved scene
// and a generated one being described by different rules.
// ── Every scene in the breakdown reaches a shoot day ──
//
// A scene the screenplay never gave a location used to leave the day
// structure entirely, and a call sheet is built from a day — so it could
// never appear on one. The breakdown knew about it, the schedule
// reported it in a list of its own, and the document the crew actually
// carries did not have it. That is a scene nobody shoots.
//
// It goes on the day its neighbours are on, so it travels with the part
// of the film it belongs to, and last within that day.
function slateAddUnplacedToDays(days, unplaced) {
  if (!days.length || !unplaced.length) return;
  var dayOf = {};
  days.forEach(function (d, i) {
    (d.scenes || []).forEach(function (s) { dayOf[Number(s.idx)] = i; });
  });
  var known = Object.keys(dayOf).map(Number).sort(function (a, b) { return a - b; });
  unplaced.forEach(function (s) {
    var idx = Number(s.idx);
    var target = days.length - 1;
    for (var i = 0; i < known.length; i++) {
      if (known[i] < idx) target = dayOf[known[i]]; else break;
    }
    days[target].scenes.push(s);
  });
}

// ── The order a shooting day actually runs ──
//
// Dawn first, because you get it once and the light is gone. Then the
// body of the day. Then dusk, which is the same problem as dawn. Night
// last, because once you have turned the lights round you are not going
// back to daylight.
//
// ONE reading of the time of day, used by two callers that both needed it.
// The grouping previously asked `indexOf('NIGHT') >= 0` inline and the
// ordering needed the same judgement — two places deciding one thing is
// the bug class that produced the scene numbers, the locations, the
// montage and the span. Only NIGHT ranks 3, so the grouping this replaces
// keeps exactly the shape it had.
function slateLightRank(tod) {
  var t = String(tod == null ? '' : tod).toUpperCase();
  if (t.indexOf('NIGHT') >= 0) return 3;
  if (t.indexOf('DUSK') >= 0 || t.indexOf('SUNSET') >= 0 || t.indexOf('EVENING') >= 0) return 2;
  if (t.indexOf('DAWN') >= 0 || t.indexOf('SUNRISE') >= 0) return 0;
  return 1;
}

// A scene's length in eighths of a page, which is how a day is costed.
//
// A scene whose eighths never arrived must not be free. If it were, a day
// would absorb any number of them and the page budget would mean nothing
// on exactly the scripts where the reading went wrong. One page is the
// honest stand-in: it is the rough average of a real scene, and it errs
// toward a lighter day rather than a longer one.
const SLATE_EIGHTHS_UNKNOWN = 8;
function slateSceneEighths(s) {
  var e = Number(s && s.eighths);
  return (isFinite(e) && e > 0) ? e : SLATE_EIGHTHS_UNKNOWN;
}
function slateEighthsOf(scenes) {
  return (scenes || []).reduce(function (a, s) { return a + slateSceneEighths(s); }, 0);
}

function slateAssignDays(slatePlaced, dayCount) {
      const normKey = slateKey;
      // Group scenes by location, keeping day and night separate
      const groups = {};
      slatePlaced.forEach(function (s) {
        var loc = String(s.loc || '').trim();
        if (loc === 'null' || loc === 'undefined' || loc === 'Unspecified') loc = '';
        // slatePlaceKey, not normKey — see the note above. Two spellings of
        // one location must not become two groups, or they become two trips.
        const key = slatePlaceKey(loc) + '|' + (slateLightRank(s.tod) === 3 ? 'N' : 'D');
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

      // ── A day is a number of PAGES, not a number of scenes ──
      //
      // Eighths were computed per scene, stored, and printed on the
      // schedule, and then played no part in deciding what a day held.
      // Nine half-page scenes and nine three-page scenes were the same day
      // to this packer. No AD schedules that way: a day is four to five
      // pages, fewer on a night exterior.
      //
      // The scene count stays as a SECOND ceiling rather than being
      // replaced, because an AD is counting two things. Twenty-five
      // half-page scenes is three pages and twenty-five setups, and the
      // setups are what runs out of daylight. A day closes when either
      // budget would be exceeded.
      const perDayEighths = Math.ceil(slateEighthsOf(slatePlaced) / dayCount) || 1;

      const days = [];
      let current = { scenes: [], locations: [], eighths: 0, light: null };

      function closeDay() {
        if (current.scenes.length) days.push(current);
        current = { scenes: [], locations: [], eighths: 0, light: null };
      }


      // Split each location into evenly-sized pieces first. A location with
      // 12 scenes and a 9-per-day limit becomes 6 and 6, not 9 and 3 — a
      // three-scene day still costs a full crew, so an even spread is both
      // cheaper and more realistic to shoot.
      //
      // Split on PAGES too, for the same reason the day budget is pages: a
      // location holding four twelve-page scenes is four days of work and
      // used to come through as one piece.
      //
      // The night flag travels with the piece. It was dropped here — the
      // grouping separated `location|D` from `location|N` correctly and
      // then this line threw the distinction away, so the packer happily
      // put a day piece and a night piece on one day.
      var pieces = [];
      ordered.forEach(function (g) {
        var byCount = Math.ceil(g.scenes.length / perDay);
        var byPages = Math.ceil(slateEighthsOf(g.scenes) / perDayEighths);
        var needed = Math.max(1, byCount, byPages);
        var size = Math.ceil(g.scenes.length / needed);
        for (var i = 0; i < g.scenes.length; i += size) {
          pieces.push({ location: g.location, night: !!g.night,
                        scenes: g.scenes.slice(i, i + size) });
        }
      });

       // Pack pieces into days, so small locations share rather than each
      // taking a day to itself.
      var overflow = [];
      pieces.forEach(function (p) {
        var pEighths = slateEighthsOf(p.scenes);
        // Either budget. Pages is the real one; setups is what runs out of
        // daylight.
        var wouldOverrun = (current.scenes.length + p.scenes.length > perDay)
                        || (current.eighths + pEighths > perDayEighths);
        // Day work and night work on one day means turning the lights
        // round mid-shoot, which no unit does by choice. Preferred, not
        // enforced: conservation matters more than purity, so this only
        // closes a day while there are days left to open. The overflow
        // placer below may still have to mix, and that is the right trade.
        var wouldMixLight = current.light !== null && current.light !== !!p.night;

        // Once every day is spoken for, hold the rest back rather than
        // dumping them all into the final day — twenty scenes across
        // seventeen locations is not a day anyone can shoot.
        if (days.length >= dayCount - 1 && wouldOverrun) {
          overflow.push(p);
          return;
        }
        if (current.scenes.length && (wouldOverrun || wouldMixLight) &&
            days.length < dayCount - 1) {
          closeDay();
        }
        if (p.location && current.locations.indexOf(p.location) < 0) current.locations.push(p.location);
        p.scenes.forEach(function (s) { current.scenes.push(s); });
        current.eighths += pEighths;
        if (current.light === null) current.light = !!p.night;
      });
      closeDay();

      // Place whatever is left. Prefer a day already going to that location —
      // returning to a place you have wrapped means travelling back, which is
      // the cost the whole grouping exists to avoid. Only when no such day
      // exists does it go to the emptiest one.
      overflow.forEach(function (p) {
        if (!days.length) {
        days.push({ scenes: p.scenes.slice(), locations: p.location ? [p.location] : [],
                    eighths: slateEighthsOf(p.scenes), light: !!p.night });
          return;
        }
        // ── Same location, but only if that day can still take it ──
        //
        // Returning to a place you have wrapped means travelling back, so
        // a day already going there is the cheap answer. It is not the
        // answer at any price. Preferring location unconditionally stacked
        // every leftover piece of one location onto the same day: on a
        // two-day test of three one-page scenes and three four-page
        // scenes, it produced a 3-page day beside a 12-page day — pages
        // measured and then ignored, which is the defect this whole change
        // is about.
        //
        // An AD would rather make a second trip than schedule a day
        // nobody can shoot. So: days at this location WITH ROOM first, then
        // any day with room, then — because a scene must land somewhere —
        // the emptiest day there is.
        var pEighths = slateEighthsOf(p.scenes);
        var hasRoom = function (d) {
          return (d.eighths || 0) + pEighths <= perDayEighths;
        };
        var sameLoc = function (d) { return d.locations.indexOf(p.location) >= 0; };
        var sameLight = function (d) { return d.light === !!p.night; };
        var and = function () {
          var fns = [].slice.call(arguments);
          return days.filter(function (d) {
            return fns.every(function (f) { return f(d); });
          });
        };

        // ── Light outranks location, and the first version had it backwards ──
        //
        // Measured on a synthetic 78-scene feature against the previous
        // packer: ordering went from 6 days out of order to 0 and the worst
        // day from 14.8 pages to 10.8, but days mixing day and night work
        // went from 2 to 7. Worse on the very thing P1.2 is about.
        //
        // The cause was this preference order. Filtering for ROOM before
        // LIGHT meant a night piece landed on a day-work day whenever the
        // only days with space were day days.
        //
        // Light and location are not the same kind of cost. Returning to a
        // wrapped location is hours of travel — expensive, and sometimes
        // worth paying. Putting day exteriors and night exteriors on one
        // day is not expensive, it is impossible: you cannot shoot daylight
        // after dark, so that day does not get shot as printed. A physical
        // constraint outranks a cost.
        //
        // So the order is: same light and same location with room, then
        // same light with room, then same location with room, then any day
        // with room, and only then the emptiest day there is — because a
        // scene with nowhere to go is still the one outcome worse than all
        // of these.
        var pool = and(sameLight, sameLoc, hasRoom);
        if (!pool.length) pool = and(sameLight, hasRoom);
        if (!pool.length) pool = and(sameLoc, hasRoom);
        if (!pool.length) pool = and(hasRoom);
        if (!pool.length) pool = and(sameLight);
        if (!pool.length) pool = days;
        // Emptiest by PAGES, not by scene count — the budget this packer
        // now works to.
        var target = pool.reduce(function (a, b) {
          return (a.eighths || 0) <= (b.eighths || 0) ? a : b;
        });
      if (p.location && target.locations.indexOf(p.location) < 0) target.locations.push(p.location);
        p.scenes.forEach(function (s) { target.scenes.push(s); });
        target.eighths = (target.eighths || 0) + pEighths;
      });

      // ── Order each day by the light ──
      //
      // The scenes sat in whatever order the pieces were pushed, so a day
      // could print night scene 3, day scene 40, night scene 7. A unit
      // shoots to the light: dawn while you have it, the body of the day,
      // then dusk, then night once the lamps are turned round.
      //
      // A STABLE sort on the light rank alone, so the location clustering
      // the grouping worked for survives inside each block. Sorting by
      // anything else here would undo the whole point of grouping.
      days.forEach(function (d) {
        d.scenes = d.scenes
          .map(function (s, i) { return { s: s, i: i, r: slateLightRank(s.tod) }; })
          .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
          .map(function (x) { return x.s; });
      });

      return days;
}

// ── Taking an assignment from the filmmaker ──
// A map of scene index to day number, sent by the workspace when someone
// moves a scene to another day.
//
// Validated rather than trusted, and refused rather than repaired. A
// schedule quietly missing a scene is worse than an error message: the
// filmmaker has no reason to go looking, and the scene surfaces on the
// morning nobody planned to shoot it. So every placeable scene must
// appear exactly once, and anything else is a 400 that says what is
// wrong.
function slateDaysFromAssignment(slatePlaced, assignment) {
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
    return { error: 'Expected a day assignment: scene index to day number.' };
  }
  var want = {}, maxDay = 0;
  var keys = Object.keys(assignment);
  if (!keys.length) {
    return { error: 'The day assignment is empty.' };
  }
  for (var k = 0; k < keys.length; k++) {
    var day = assignment[keys[k]];
    if (typeof day !== 'number' || !isFinite(day) || day < 1 || day !== Math.floor(day)) {
      return { error: 'Scene ' + keys[k] + ' was given day "' + day + '", which is not a shoot day.' };
    }
    want[String(keys[k])] = day;
    if (day > maxDay) maxDay = day;
  }

  // Every placeable scene, exactly once. One missing loses it from the
  // schedule entirely; one we do not recognise means the workspace and
  // the breakdown disagree about what this production contains, and
  // choosing which of them is right is not ours to do.
  var missing = [];
  slatePlaced.forEach(function (s) {
    if (want[String(s.idx)] === undefined) missing.push(s.n == null ? '(unnumbered)' : s.n);
  });
  if (missing.length) {
    return { error: 'These scenes were left out of the assignment: ' + missing.join(', ') + '.' };
  }
  var known = {};
  slatePlaced.forEach(function (s) { known[String(s.idx)] = true; });
  var unknown = keys.filter(function (key) { return !known[key]; });
  if (unknown.length) {
    return { error: 'The assignment refers to scenes this breakdown does not have: ' + unknown.join(', ') + '.' };
  }

  // Empty days are kept rather than squeezed out. Dropping one renumbers
  // every day after it and silently moves their dates, which is a
  // surprising thing to do to someone who emptied a day meaning to refill
  // it.
  var days = [];
  for (var d = 0; d < maxDay; d++) days.push({ scenes: [], locations: [] });
  slatePlaced.forEach(function (s) { days[want[String(s.idx)] - 1].scenes.push(s); });
  return { days: days };
}

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
    const { breakdown, start_date, shoot_days, day_assignment } = JSON.parse(event.body);

    if (!breakdown) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No breakdown data provided' }) };
    }

    // ── STEP 2: Initialize Supabase ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── STEP 3: Single-pass user verification ──
    // Verified, not claimed. user_email and user_id used to come straight
    // from the request body, so a caller named themselves — including
    // naming themselves an admin, which skips the rate limit.
    const auth = await slateAuthenticate(event, supabase);
    if (!auth.ok) {
      return { statusCode: auth.status, headers, body: JSON.stringify({ error: auth.error }) };
    }
    const user = auth.user;
    const isAdminEmail = isAdmin(auth.email);

    // Rate limit AFTER authenticating: it keys on the account and exempts
    // admins, and both of those were previously decided by the caller.
    if (!isAdminEmail) {
      const clientIP = getClientIP(event);
      const rateLimit = await checkRateLimit(clientIP, 'schedule', 5, SUPABASE_SECRET, auth.authId || null);
      if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'schedule');
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
        // Never invented. A montage has no interior or exterior, and
        // defaulting a blank to INT printed "INT" beside "Various
        // Locations" on a shooting schedule — a statement about how the
        // scene shoots that the script never makes.
        ie: s.int_ext || '',
        tod: s.time_of_day || 'DAY',
        loc: s.location || s.set_location || '',
        set: s.set || '',
        // Page length, measured off the script at split time. A day's total
        // is how a production manager judges whether the day is achievable,
        // so it has to travel with the scene.
        eighths: Number(s.slate_eighths) || 0,
        // The story day, carried verbatim. It was normalised once at merge
        // time and is never re-read here — a second reader is a second
        // opinion, and continuity is the last place that helps.
        //
        // It travels because a shoot day is assembled out of script order:
        // the scenes of one story morning can land on three different
        // shoot days, and wardrobe can only plan for that if the schedule
        // says so.
        sd: s.story_day || '',
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

      // One assignment, two ways to arrive at one. A filmmaker who has
      // moved a scene sends theirs; everyone else gets the packer's. Both
      // go through the same derivation below, which is the whole point.
      var days;
      if (day_assignment) {
        var built = slateDaysFromAssignment(slatePlaced, day_assignment);
        if (built.error) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: built.error }) };
        }
        days = built.days;
      } else {
        days = slateAssignDays(slatePlaced, dayCount);
      }
      // After the days exist, never before: an unplaced scene has no
      // location to group on, so it joins the day its neighbours landed on.
      slateAddUnplacedToDays(days, slateUnplaced);

      // Everything from here follows from the day assignment above, and is
      // derived in one place so that a hand-moved scene and a generated one
      // can never be computed by different rules.
      schedule = slateDeriveSchedule(days, breakdown, slimScenes, slatePlaced, slateUnplaced, start_date);

      // ── Small AI pass for production notes only — fails safe ──
      // Skipped when the filmmaker sent an assignment. Moving a scene is
      // something a production manager does several times in a sitting —
      // this actor Thursday, that location Friday — and an AI call on each
      // one would cost money and a wait every time, to rewrite notes about
      // a day that is about to be rearranged again.
      //
      // The notes that were already there are not carried over here. A note
      // written for a day's old scenes describes a day that no longer
      // exists, and a stale production note names the wrong place, which is
      // the failure this prompt was written to prevent. The workspace
      // carries notes forward only for days whose scenes did not change.
      if (!day_assignment) try {
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


// Exported so the derivation can be tested directly, without a request.
module.exports.slateDeriveSchedule = slateDeriveSchedule;

module.exports.slateAssignDays = slateAssignDays;
module.exports.slateAddUnplacedToDays = slateAddUnplacedToDays;
module.exports.slateDaysFromAssignment = slateDaysFromAssignment;
