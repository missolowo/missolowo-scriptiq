// ============================================================
// MISSOLOWO SLATE — SHARED CORE (server side)
// ============================================================
// One definition of the logic that both Netlify Functions need.
// Before this file, name normalisation existed three times, scene
// sorting twice and the admin list four times — and a fix applied to
// one copy silently left the others wrong. The A-Z name key was fixed
// in the browser on 23 Sep and missed here, so every Korean, Russian,
// Arabic, Hindi and Chinese name normalised to an empty string in both
// functions.
//
// MIRRORED IN app.html (slateKey / slateBetterLabel / sorting).
// The browser and Netlify Functions cannot import from each other
// without a build step, which is deferred post-launch. Until then:
// a change here REQUIRES the same change in app.html, same commit.
// ============================================================

const ADMIN_EMAILS = ['missolowoai@gmail.com', 'omoyeni38@gmail.com'];

// Match names case-, accent- and punctuation-insensitively.
// Keeps letters and digits from ANY script: stripping to A-Z turned
// 지훈, Ирина and Bùkọ́lá into empty keys, so those characters merged
// into one another or vanished from the documents entirely.
function slateKey(name) {
  return String(name || '')
    // "Ernest" and "Ernest (V.O.)" are one actor — one row, one call time.
    .replace(/\s*\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D|CONTINUED|PRE-?LAP|FILTERED|ON\s+PHONE|OFF)\)\s*/gi, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/['''`]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefer the more readable spelling: mixed case over shouting.
// Tested with \p{Ll} and \p{Lu} rather than /[a-z]/, because Yorùbá
// "BÙKỌ́LÁ" contains lowercase ù and ọ́ — an A-Z test called it mixed
// case and blended two spellings into "Bùkọ́LÁ".
function slateBetterLabel(a, b) {
  const A = String(a || ''), B = String(b || '');
  const mixedA = /\p{Ll}/u.test(A) && /\p{Lu}/u.test(A);
  const mixedB = /\p{Ll}/u.test(B) && /\p{Lu}/u.test(B);
  if (mixedA && !mixedB) return A;
  if (mixedB && !mixedA) return B;
  return A.length >= B.length ? A : B;
}

// Ascending scene order as a production manager reads it:
// 9 before 10, and 47A after 47 but before 48.
function bySceneNumber(a, b) {
  const na = parseFloat(String(a).replace(/[^0-9.]/g, '')) || 0;
  const nb = parseFloat(String(b).replace(/[^0-9.]/g, '')) || 0;
  if (na !== nb) return na - nb;
  return String(a).localeCompare(String(b));
}

// Same order, for objects carrying a scene_number.
function bySceneNumberField(field) {
  return function (a, b) { return bySceneNumber(a[field], b[field]); };
}

function isAdmin(email) {
  return !!email && ADMIN_EMAILS.indexOf(email) !== -1;
}

// ── WHOSE ACTIVITY IS OURS, NOT A CUSTOMER'S ──
// Server-side only — it reads the database, so there is nothing to mirror
// in app.html.
//
// Weeks of engine work ran the same fixture scripts over and over, and our
// own test purchases go through the live payment flow because that is the
// only way to know the live payment flow works. Neither is demand. Any
// figure that means "customers" has to exclude these accounts, and until
// now each place that cared decided for itself what "ours" meant.
//
// An account is ours if its role is admin, or its address is listed here.
// Adding an address here is the whole change — no other file.
const INTERNAL_EMAILS = ADMIN_EMAILS.concat([
  // Accounts used for building and testing. Gmail treats a +suffix as the
  // same inbox, so a +test address is matched against its base below.
]);

// The user ids behind those addresses.
//
// Returns null when the list cannot be read — which is NOT the same as
// "nobody is internal", and callers must not treat it as an empty array.
// The distinction is the whole point: an empty array means we looked and
// found none; null means we do not know, and a caller that silently
// excludes nobody is reporting our own testing as customer demand.
async function internalUserIds(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('users').select('id, email, role');
    if (error || !data) return null;
    return data.filter(function (u) {
      if (u.role === 'admin') return true;
      const e = String(u.email || '').toLowerCase();
      if (INTERNAL_EMAILS.indexOf(e) !== -1) return true;
      // someone+test@gmail.com is the same person as someone@gmail.com
      return INTERNAL_EMAILS.indexOf(e.replace(/\+[^@]*(?=@)/, '')) !== -1;
    }).map(function (u) { return u.id; });
  } catch (e) {
    return null;
  }
}

// ── CHANGING A CREDIT BALANCE ──
// Server-side only. Every change to credits_remaining goes through here.
//
// It used to be done by reading the balance into JavaScript, doing the sum
// and writing an absolute number back. breakdown.js read the user at the
// START of the request and wrote `that value - 1` at the END, with the AI
// run in between — minutes — and never re-read. So it was not a decrement,
// it was an overwrite with a stale figure, and whichever write landed last
// silently discarded the other.
//
// What that did to a filmmaker: she has 1 credit, starts a breakdown, buys
// a 5-credit pack while she waits. The payment lands correctly, 1 + 5 = 6.
// The breakdown finishes and writes max(0, 1 - 1) = 0. She paid ₦4,000 and
// watched her balance go to zero. Topping up while you wait is the most
// natural thing in the world, and the product invites it — the billing
// panel is right there and the wait is long.
//
// Now: read the balance, then make the write CONDITIONAL on it still being
// what we read. If anything changed in between the filter matches no rows,
// nothing is written, and we read again and retry. The race window goes
// from minutes to the gap between two adjacent queries.
//
// What this is NOT: a true atomic operation. It compares the value, not a
// version, so a balance that left and returned to the same number between
// our read and our write would slip through. That needs two opposing
// changes of exactly matching size landing inside a microsecond window. The
// complete fix is `credits_remaining = credits_remaining - 1` in Postgres,
// which needs a database function; this ships without one, under a launch
// freeze, and is revertible by a single deploy.
//
// Returns { ok, balance, reason }. Callers must check ok — a failure here
// must never be mistaken for a charge.
async function slateAdjustCredits(supabase, userId, delta, extra) {
  if (!supabase || !userId || !delta) return { ok: false, reason: 'bad_request' };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var read;
    try {
      read = await supabase.from('users')
        .select('credits_remaining, credits_used')
        .eq('id', userId)
        .single();
    } catch (e) {
      return { ok: false, reason: 'unreadable' };
    }
    if (!read || read.error || !read.data) return { ok: false, reason: 'unreadable' };

    var have = read.data.credits_remaining || 0;

    // Spending what is not there. The guard and the charge are ONE
    // operation now — they used to be two separate reads, so two tabs
    // could both pass the check and both be served on one credit.
    if (delta < 0 && have < -delta) {
      return { ok: false, reason: 'insufficient', balance: have };
    }

    var patch = { credits_remaining: have + delta, updated_at: new Date().toISOString() };
    if (delta < 0) patch.credits_used = (read.data.credits_used || 0) + 1;
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) patch[k] = extra[k];

    var write;
    try {
      write = await supabase.from('users')
        .update(patch)
        .eq('id', userId)
        .eq('credits_remaining', have)   // ← the whole point: only if unchanged
        .select('credits_remaining');
    } catch (e) {
      return { ok: false, reason: 'write_failed' };
    }
    if (!write || write.error) return { ok: false, reason: 'write_failed' };

    // Rows came back: ours was the write that landed.
    if (write.data && write.data.length) {
      return { ok: true, balance: have + delta };
    }
    // No rows: somebody changed the balance between our read and our write.
    // Read it again and work from what is true now.
  }

  // Three rounds of losing the race. Vanishingly unlikely, and the caller
  // decides what to do about it — for a charge, the documents are already
  // generated, so refusing them would be the worse outcome.
  return { ok: false, reason: 'contended' };
}

function slateChargeCredit(supabase, userId) {
  return slateAdjustCredits(supabase, userId, -1);
}

function slateAddCredits(supabase, userId, howMany, extra) {
  return slateAdjustCredits(supabase, userId, Math.abs(howMany || 0), extra);
}

module.exports = {
  ADMIN_EMAILS, INTERNAL_EMAILS, isAdmin, internalUserIds,
  slateAdjustCredits, slateChargeCredit, slateAddCredits,
  slateKey, slateBetterLabel, bySceneNumber, bySceneNumberField
};
