// ============================================
// SCRIPTIQ — FEEDBACK FUNCTION
// Saves user feedback and ratings to Supabase
// Netlify Function — Secure Backend (CISO Hardened)
// ============================================
const { createClient } = require('@supabase/supabase-js');
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
      user_email,
      user_id,
      breakdown_title,
      feature
    } = JSON.parse(event.body);

    if (!rating) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Rating is required' })
      };
    }

    // ── FIX: Sanitize blank string parameters to true NULL ──
    // Prevents Supabase UUID parsing crashes when empty strings
    // are passed instead of null from the frontend
    const sanitizedUserId    = (user_id    && user_id.trim()    !== '') ? user_id.trim()    : null;
    const sanitizedUserEmail = (user_email && user_email.trim() !== '') ? user_email.trim() : null;

    // ── Rate limit — 20 feedback submissions per IP per hour ──
    const clientIP = getClientIP(event);
    const rateLimit = await checkRateLimit(clientIP, 'feedback', 20, SUPABASE_SECRET, sanitizedUserId);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'feedback');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ── Save feedback safely to Supabase ──
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        rating:          parseInt(rating, 10),          // Explicit base 10
        feedback_text:   feedback_text   || null,
        user_email:      sanitizedUserEmail,            // Guaranteed null or valid email
        user_id:         sanitizedUserId,               // Guaranteed null or valid UUID
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
