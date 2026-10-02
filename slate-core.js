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
  // A dialogue modifier is never part of a character's name. The key strips
  // them so "Ernest" and "Ernest (V.O.)" match, but the DISPLAY label fell
  // through to "longer wins" and printed the modifier on the call sheet.
  const modRe = /\s*\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D|CONTINUED|PRE-?LAP|FILTERED|ON\s+PHONE|OFF)\)\s*/i;
  const modA = modRe.test(A), modB = modRe.test(B);
  if (modA && !modB) return B;
  if (modB && !modA) return A;
  const mixedA = /\p{Ll}/u.test(A) && /\p{Lu}/u.test(A);
  const mixedB = /\p{Ll}/u.test(B) && /\p{Lu}/u.test(B);
  if (mixedA && !mixedB) return A;
  if (mixedB && !mixedA) return B;
  return A.length >= B.length ? A : B;
}

// A name the script only ever SHOUTS still has to read like a name on the
// document a crew is handed. Screenplays write cues in capitals, so a
// character who never appears in dialogue text reached the call sheet as
// ARTEM SOKOLOV beside Irina Petrova — both correct, one shouting.
//
// Only touched when there is no lowercase letter anywhere: if the script
// offers a better spelling, slateBetterLabel has already chosen it.
// Scripts without letter case are never altered.
// MIRRORED IN app.html (slateTitleCase) — change both together.
function slateTitleCase(name) {
  const str = String(name || '');
  if (!str) return str;
  if (/\p{Ll}/u.test(str)) return str;
  if (!/\p{Lu}/u.test(str)) return str;
  if ((str.match(/\p{L}/gu) || []).length < 3) return str;
  return str.replace(/\p{L}[\p{L}\p{M}'’.-]*/gu, function (word) {
    if (/^(?:\p{L}\.){1,3}$/u.test(word)) return word;
    return word.toLowerCase()
      .replace(/^(\p{L})/u, function (m, ch) { return ch.toUpperCase(); })
      .replace(/([-'’])(\p{L})(?=\p{L})/gu, function (m, sep, ch) { return sep + ch.toUpperCase(); });
  });
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

module.exports = { ADMIN_EMAILS, isAdmin, slateKey, slateBetterLabel, slateTitleCase, bySceneNumber, bySceneNumberField };
