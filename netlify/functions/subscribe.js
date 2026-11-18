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

// WHICH NOTICE THEY AGREED TO.
//
// This string is recorded against every subscriber, and it refers to one
// exact sentence under the signup button in app.html:
//
//   "By signing up, you'll get a welcome email and occasional updates
//    from Missolowo Slate. You can unsubscribe at any time."
//
// If that sentence changes, BUMP THIS. The whole value of a consent record
// is being able to say which words a person actually read; a version that
// silently covers two different notices is worth nothing, and the question
// only ever gets asked when it matters.
const SLATE_SIGNUP_NOTICE_VERSION = 'v1-2026-11-17';

// MailerLite requires 'yyyy-MM-dd HH:mm:ss' and rejects anything more than
// an hour in the future. Not ISO-8601: toISOString() gives '2026-11-17T…Z'
// and the 'T' alone makes it invalid. UTC, so the record does not shift
// with whoever is reading it.
function slateMailerLiteTime(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// The first name to greet somebody by, from the full name they typed.
// Returns '' when there is nothing usable, and the caller then sends no
// name field at all rather than an empty one.
//
// Everything this has to survive is in the tests; the short version is
// that people type their names in every shape there is, and the result of
// this function is printed directly after the word "Hi".
function slateFirstName(value) {
  const first = String(value == null ? '' : value).trim().split(/\s+/)[0] || '';
  if (!first) return '';
  // Lower-case first so "MUIDEEN" and "muideen" land in the same place,
  // then raise the first letter of the name and of each part after a
  // hyphen or an apostrophe. On a script with no capitals this is a no-op
  // rather than damage, which is why it is \p{L} and not [a-z].
  return first.toLowerCase().replace(
    /(^|[-'’])(\p{L})/gu,
    (whole, separator, letter) => separator + letter.toUpperCase());
}

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
    let createdAt = null;
    try {
      const res = await supabase.from('users')
        .select('full_name, created_at').eq('id', user.id).single();
      fullName = (res && res.data && res.data.full_name) || '';
      createdAt = (res && res.data && res.data.created_at) || null;
    } catch (e) {
      fullName = '';
    }
    fullName = String(fullName).trim();

    // ── The consent record ──
    //
    // subscribed_at is the moment the ACCOUNT was created, not the moment
    // this function happened to run. They are seconds apart in the normal
    // case, but if this is ever replayed to catch up a missed signup, the
    // account's own timestamp is the honest answer to "when did they agree
    // to this" and the clock time is not.
    //
    // ip_address is where they signed up from. MailerLite ignores a value
    // that is not a valid IP, so a proxy header we cannot parse costs
    // nothing. It goes no further than this field: it is a consent record,
    // not analytics, and nothing else here reads it.
    const body = {
      email: user.email,
      groups: [String(MAILERLITE_GROUP_ID)],
      fields: { signup_notice_version: SLATE_SIGNUP_NOTICE_VERSION }
    };

    // A FIRST NAME, or no name field at all.
    //
    // MailerLite greets with this field, so what goes in it is read as
    // "Hi <this>,". The first real signup stored their name as "muideen
    // adewole ibrahim" — lower case, three parts — which would have been
    // sent out as "Hi muideen adewole ibrahim,". So: the first word only,
    // capitalised.
    //
    // NOT an empty string when there is no name: an empty string still
    // substitutes in MailerLite and the filmmaker reads "Hi ,". Omitting
    // the field entirely lets MailerLite's fallback greeting apply.
    //
    // THE KNOWN COST, accepted by the Founder: where someone has written
    // their surname first, the greeting uses their surname. Across the 57
    // accounts held when this was decided, 47 names were two words, 5 were
    // three or more, 3 were one word and 2 were blank, and nothing in the
    // data says which way round any of them was written. The 5 longer names
    // are where that risk sits.
    //
    // Capitalisation follows the segment, not just the string: a letter
    // after a hyphen or an apostrophe is capitalised too, so "o'brien"
    // becomes "O'Brien" and "ade-bayo" becomes "Ade-Bayo" rather than
    // "O'brien" and "Ade-bayo". Misspelling someone's name is worse than
    // the surname problem above. Both straight and curly apostrophes count,
    // because Word chooses which one without asking the writer.
    //
    // \p{L} with the u flag rather than [a-z], so a Yorùbá name keeps every
    // diacritic and a name in a script with no capitals passes through
    // untouched instead of being mangled by a rule that means nothing in it.
    const greeting = slateFirstName(fullName);
    if (greeting) body.fields.name = greeting;

    const subscribedAt = slateMailerLiteTime(createdAt);
    if (subscribedAt) body.subscribed_at = subscribedAt;
    if (ip) body.ip_address = ip;

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
