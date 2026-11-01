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

module.exports = {
  ADMIN_EMAILS, INTERNAL_EMAILS, isAdmin, internalUserIds,
  slateKey, slateBetterLabel, bySceneNumber, bySceneNumberField
};
