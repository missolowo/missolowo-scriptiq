// ============================================
// MISSOLOWO SLATE — SUBSCRIBE FUNCTION
// Tells MailerLite that somebody has signed up, so a welcome email can
// reach them without Elizabeth adding them by hand.
// ============================================
//
// WHY THIS EXISTS AS A FUNCTION AT ALL
//
// Signup does not pass through any Netlify function: the browser posts
// straight to Supabase auth. So there is no server-side step to hang this
// on, and calling MailerLite from the browser is not an option — this
// repository is public, so the API key would be readable by anybody.
//
// THE ADDRESS COMES FROM THE TOKEN, NEVER FROM THE REQUEST
//
// This is the one decision in the file that matters. If the endpoint
// accepted an email address in the body, anybody could post to it and
// subscribe any address they liked, from Elizabeth's own sending domain.
// That is a spam relay with her name on it, and it would cost her the
// domain reputation that her signup confirmation emails depend on.
//
// So the address and name are read from the profile that slateAuthenticate
// resolves out of the verified token. The body is ignored entirely. There
// is deliberately no parameter here to override who gets subscribed.
//
// IT CAN NEVER BLOCK A SIGNUP
//
// Four layers, and the first is the one that actually counts:
//
//   1. Structural. The account exists before this is ever called. Supabase
//      has created it and the person is signed in. Delete this file and
//      signup is unaffected.
//   2. The caller does not await it (see app.html). The workspace loads
//      whether this returns, fails or hangs.
//   3. It returns 200 on every outcome except a bad method or a failed
//      sign-in check. A non-200 would surface in the browser to somebody
//      who has just joined, for a problem that is not theirs.
//   4. A hard timeout on the MailerLite call, so it cannot sit open.
//
// WHAT IT IS NOT
//
// It does not move anybody between groups as their behaviour changes, and
// it does not keep the three segment groups current. Those are a separate
// piece of work. This adds a new signup to one group, once.
const { createClient } = require('@supabase/supabase-js');
const { slateAuthenticate } = require('./lib/slate-core');
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

// Both live only in Netlify's environment variables, like every other
// secret here. Neither is ever committed, and neither reaches the browser.
const MAILERLITE_API_KEY  = process.env.MAILERLITE_API_KEY;
const MAILERLITE_GROUP_ID = process.env.MAILERLITE_SIGNUP_GROUP_ID;

// Long enough for a normal call, short enough that nobody notices. The
// MailerLite API answers in well under a second in practice; this is the
// ceiling for the case where it does not answer at all.
const SLATE_MAILERLITE_TIMEOUT_MS = 5000;

exports.handler = async function (event) {
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

  // Everything below this line answers 200. A filmmaker who has just
  // created an account must never see a failure that belongs to our
  // email provider.
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // Who is calling. Required: this is how we know whose address to use.
    const auth = await slateAuthenticate(event, supabase);
    if (!auth.ok) {
      return { statusCode: auth.status || 401, headers,
               body: JSON.stringify({ error: auth.error }) };
    }
    const user = auth.user;

    // Signature matches rate-limiter.js as defined, and feedback.js,
    // callsheet.js, schedule.js and both payment functions as called.
    // breakdown.js calls it with a different argument order; that is
    // either a bug there or a second convention, and worth settling
    // separately rather than copying.
    const ip = getClientIP(event);
    const limit = await checkRateLimit(ip, 'subscribe', 20, SUPABASE_SECRET, user.id);
    if (!limit.allowed) return rateLimitResponse(limit.resetAt, 'subscribe');

    if (!MAILERLITE_API_KEY || !MAILERLITE_GROUP_ID) {
      // Not configured yet. This is the normal state until the key is set
      // in Netlify, and it must look like success to the caller.
      console.warn('[Slate] subscribe: MailerLite not configured — nothing sent');
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent: false }) };
    }

    // The name as stored, or nothing at all. NOT an empty string: an empty
    // string still substitutes in MailerLite, and the filmmaker gets a
    // greeting reading "Hi ," which looks broken. Sending no field lets
    // the fallback greeting apply.
    //
    // slateAuthenticate selects a narrow set of columns and full_name is
    // not among them, so it is read here rather than assumed.
    let fullName = '';
    try {
      const res = await supabase.from('users')
        .select('full_name').eq('id', user.id).single();
      fullName = (res && res.data && res.data.full_name) || '';
    } catch (e) {
      fullName = '';
    }
    fullName = String(fullName).trim();

    const body = { email: user.email, groups: [String(MAILERLITE_GROUP_ID)] };
    if (fullName) body.fields = { name: fullName };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLATE_MAILERLITE_TIMEOUT_MS);
    let sent = false;
    try {
      const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + MAILERLITE_API_KEY
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      sent = res.ok;
      if (!res.ok) {
        // The status, never the response body: an error body can echo the
        // address back, and this log is not the place for it.
        console.error('[Slate] subscribe: MailerLite returned ' + res.status);
      }
    } catch (e) {
      console.error('[Slate] subscribe: MailerLite call failed — ' + e.name);
    } finally {
      clearTimeout(timer);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent: sent }) };
  } catch (e) {
    // Including a malformed request. Nothing here is worth failing a
    // signup over.
    console.error('[Slate] subscribe: unexpected — ' + e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, sent: false }) };
  }
};
