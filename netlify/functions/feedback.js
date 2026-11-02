// ============================================
// SCRIPTIQ — FEEDBACK FUNCTION
// Saves user feedback and ratings to Supabase
// Netlify Function — Secure Backend (CISO Hardened)
// ============================================
const { createClient } = require('@supabase/supabase-js');
const { slateAuthenticate } = require('./lib/slate-core');
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
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
    const {
      rating,
      feedback_text,
      breakdown_title,
      feature,
      kind,
      context
    } = JSON.parse(event.body);

    // A bug report does not need a star rating. Require something, though —
    // an empty submission helps nobody.
    if (!rating && !(feedback_text && String(feedback_text).trim())) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Please tell us what happened, or leave a rating.' })
      };
    }
    

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Who is calling, IF anyone ──
    // Optional on purpose, unlike every other function. A filmmaker who
    // cannot sign in must still be able to tell us that — "I can't log in"
    // is precisely the report we most need, and requiring a session to send
    // it would silence it.
    //
    // So: a valid token attributes the feedback to that verified account; no
    // token files it anonymously. What is NOT possible any more is filing
    // feedback UNDER SOMEONE ELSE'S NAME, which is what reading the address
    // out of the request body allowed. An attached address is now one
    // Supabase vouched for.
    //
    // A disabled account is not refused here either. Being shut out is a
    // thing worth complaining about.
    let sanitizedUserId = null, sanitizedUserEmail = null;
    const auth = await slateAuthenticate(event, supabase);
    if (auth.ok) {
      sanitizedUserId = auth.authId || null;
      sanitizedUserEmail = auth.email || null;
    }

    // ── Rate limit — 20 feedback submissions per IP per hour ──
    const clientIP = getClientIP(event);
    const rateLimit = await checkRateLimit(clientIP, 'feedback', 20, SUPABASE_SECRET, sanitizedUserId);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'feedback');

    // ── Save feedback safely to Supabase ──
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        rating:          rating ? parseInt(rating, 10) : null,
        kind:            kind || 'general',
        context:         context || null,
        feedback_text:   feedback_text   || null,
        user_email:      sanitizedUserEmail,            // Verified by Supabase, or null
        user_id:         sanitizedUserId,               // Verified by Supabase, or null
        breakdown_title: breakdown_title || null,
        feature:         feature         || 'script_breakdown',
        created_at:      new Date().toISOString()
      });

    if (error) {
      console.error('Supabase integration write error:', error.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to process feedback payload.' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Thank you for your feedback!'
      })
    };

  } catch (error) {
    console.error("[CISO Fatal Catch] Feedback exception routing error:", error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to save feedback: ' + error.message })
    };
  }
};
