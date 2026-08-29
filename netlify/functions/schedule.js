// ============================================
// SCRIPTIQ — SHOOTING SCHEDULE FUNCTION
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
       // Scheduling only needs scene identity, location, timing and cast.
    // Sending full descriptions/props/costume blew the function timeout.
    const slimScenes = (breakdown.scenes || []).map(function (s) {
      return {
        n: s.scene_number,
        ie: s.int_ext || 'INT',
        tod: s.time_of_day || 'DAY',
        loc: s.location || s.set_location || '',
        cast: (s.cast || []).slice(0, 8)
      };
    });
      // ── Build the schedule in CODE — deterministic, instant, no timeout ──
    // The AI only adds production notes afterwards. Grouping scenes by
    // location is arithmetic, not judgement, so code does it reliably.
     let schedule;
    try {
    const dayCount = Math.max(1, parseInt(shoot_days, 10) || 10);

    function normKey(s) {
      return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Group scenes by location, keeping day and night separate
    const groups = {};
    slimScenes.forEach(function (s) {
      const key = normKey(s.loc) + '|' + (String(s.tod).toUpperCase().indexOf('NIGHT') >= 0 ? 'N' : 'D');
      if (!groups[key]) groups[key] = { location: s.loc || 'Unspecified', night: key.endsWith('|N'), scenes: [] };
      groups[key].scenes.push(s);
    });

    // Largest groups first so big locations aren't split across days
    const ordered = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.scenes.length - a.scenes.length; });

    // Distribute into shoot days
    const perDay = Math.ceil(slimScenes.length / dayCount) || 1;
    const days = [];
    let current = { scenes: [], location: '' };
    ordered.forEach(function (g) {
      g.scenes.forEach(function (s) {
        if (current.scenes.length >= perDay && days.length < dayCount - 1) {
          days.push(current);
          current = { scenes: [], location: '' };
        }
        if (!current.location) current.location = g.location;
        current.scenes.push(s);
      });
    });
    if (current.scenes.length) days.push(current);

    // Dates
       function addDays(dateStr, n) {
      var d;
      try { d = new Date(String(dateStr || '').replace(/^[A-Za-z]+\s+/, '')); } catch (e) { return ''; }
      if (!d || isNaN(d.getTime())) return '';
      d.setDate(d.getDate() + n);
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    const baseDate = start_date || 'Monday 30 June 2026';

    schedule = {
      title: breakdown.title || 'Untitled Production',
      total_shoot_days: days.length,
      total_scenes: slimScenes.length,
      schedule: days.map(function (d, i) {
        return {
          day: i + 1,
          date: addDays(baseDate, i) || baseDate,
          location: d.location,
          scenes: d.scenes.map(function (s) {
            return {
              scene_number: s.n,
              int_ext: s.ie,
              time_of_day: s.tod,
              description: '',
              cast_required: s.cast || [],
              props: []
            };
          }),
          production_notes: ''
        };
      }),
      cast_release_schedule: []
    };

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
    schedule.cast_release_schedule = Object.keys(castDays).map(function (k) {
      const c = castDays[k];
            var dr = c.days_required.length ? c.days_required : [1];
      return { character: c.character, days_required: dr, release_day: Math.max.apply(null, dr) };
    });

    // ── Small AI pass for production notes only — fails safe ──
    try {
      const notePrompt = 'You are a Nollywood production manager. For each shoot day below, write one short production note (logistics, moves, night-shoot warnings). Return JSON: {"notes":[{"day":1,"note":"..."}]}\n\n'
        + JSON.stringify(schedule.schedule.map(function (d) {
            return { day: d.day, location: d.location, scenes: d.scenes.length, night: d.scenes.filter(function (s) { return String(s.time_of_day).toUpperCase().indexOf('NIGHT') >= 0; }).length };
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
,
        body:     } catch (e) {
      console.warn('[Slate] Production notes unavailable:', e.message);
    } 
        } catch (buildErr) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'DIAGNOSTIC: ' + buildErr.message, stack: (buildErr.stack || '').split('\n').slice(0, 3).join(' | ') })
      };
    }   
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
      body: JSON.stringify({ error: 'Failed to generate schedule: ' + error.message, where: (error.stack || '').split('\n')[1] || '' })
    };
  }
};
