// Who is one person, who is two, and who is not a person at all.
//
// From a real character report sent in by a producer on 16 November:
//
//   8  Glory        #24, #40, #43        3
//   12 Girl Voice   11                   1
//   13 Paul         13                   1
//   14 All The Guys 14                   1
//   6  Ben Paul     14, #21, #23 ...     13
//
// Three different faults, needing three different answers.
//
// "Girl Voice" is the same performer as "Girl" — a voice credit, which
// slateKey caught only in its parenthesised form. MERGED, because a voice
// credit is unambiguously the same actor.
//
// "Paul" (1 scene) beneath "Ben Paul" (13) is almost certainly one man. But
// almost is not enough: merging two performers into one call sheet row with
// one call time is worse than showing a duplicate. FLAGGED, never merged.
//
// "All The Guys" is a stage direction holding a cast number, and a cast
// number is what a call sheet calls. FLAGGED, and left in place — silently
// deleting a line is how somebody finds out on the day that their extras
// were never booked.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(startNeedle) {
  const s = APP.indexOf(startNeedle);
  if (s < 0) { console.error('NOT FOUND: ' + startNeedle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}
function line(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf('\n', s));
}

const SRC = [
  block('function slateKey'),
  block('function slateCastKey'),
  line('var SLATE_GROUP_CAST'),
  block('function slateCastReview'),
  block('function slateCastReviewHtml')
].join('\n');
const api = new Function(SRC +
  '; return { key: slateKey, castKey: slateCastKey, review: slateCastReview, html: slateCastReviewHtml };')();

const same = (a, b) => api.castKey(a) === api.castKey(b);
const ch = (character, total) => ({ character: character, total: total, scenes: [] });

// ══════════════════════════════════════════════
console.log('\nA voice credit is the same actor');
{
  ok('"Girl" and "Girl Voice" are one person', same('Girl', 'Girl Voice'));
  ok('"Girl" and "Voice of Girl" are one person', same('Girl', 'Voice of Girl'));
  ok('"Ada" and "Ada Voice Over" are one person', same('Ada', 'Ada Voice Over'));
  ok('"Voice Over Tade" and "Tade" are one person', same('Voice Over Tade', 'Tade'));
  ok('the parenthesised form still works',
     same('Ernest', 'Ernest (V.O.)'),
     'slateKey already handled this; it must not have regressed');
  ok('  ...and O.S. too', same('Ernest', 'Ernest (O.S.)'));
}

console.log('\nBut a character actually called VOICE keeps their name');
{
  ok('"Voice" does not key to nothing', api.castKey('Voice') === 'VOICE',
     api.castKey('Voice'));
  ok('  ...so they still appear in the report',
     !!api.castKey('Voice'),
     'an empty key drops a performer from Report 2 entirely');
}

console.log('\nVoice handling stays OUT of slateKey, which also keys locations');
{
  // "Voice Studio" is not "Studio". Locations go through slateKey, so the
  // voice rule lives in slateCastKey alone.
  ok('slateKey leaves a voice word alone', api.key('Girl Voice') === 'GIRL VOICE');
  ok('  ...so a set called "Voice Studio" is not folded into "Studio"',
     api.key('Voice Studio') !== api.key('Studio'));
}

// ══════════════════════════════════════════════
console.log('\nPossible duplicates are reported, never merged');
{
  const r = api.review([ch('Bayo', 23), ch('Ben Paul', 13), ch('Paul', 1), ch('Tayo', 4)]);
  ok('Paul and Ben Paul are flagged',
     r && r.pairs.some(p => p.shorter === 'Paul' && p.longer === 'Ben Paul'),
     JSON.stringify(r && r.pairs));
  ok('  ...with both scene counts, so a reader can judge',
     r.pairs[0].shortTotal === 1 && r.pairs[0].longTotal === 13);
  ok('  ...and they are still TWO entries, not merged',
     !same('Paul', 'Ben Paul'),
     'merging two performers into one call row is the worse mistake');
  ok('the wording says we left them alone',
     /left them as they are/.test(api.html([ch('Ben Paul', 13), ch('Paul', 1)])));
}

console.log('\nA shorter name that is not a shortening is left alone');
{
  // The dangerous false positive. "Ada" is not a short form of "Adaeze" —
  // it is a different name, and flagging it teaches people to ignore us.
  ok('Ada and Adaeze are not flagged',
     api.review([ch('Ada', 5), ch('Adaeze', 3)]) === null);
  ok('Tade and Tadeo are not flagged',
     api.review([ch('Tade', 4), ch('Tadeo', 2)]) === null);
  ok('a one-word name inside another one-word name is not flagged',
     api.review([ch('Bay', 1), ch('Bayo', 9)]) === null,
     'containment only counts across a word boundary');
}

// ══════════════════════════════════════════════
console.log('\nGroup directions are named, not deleted');
{
  const r = api.review([ch('All The Guys', 1), ch('Bayo', 23)]);
  ok('"All The Guys" is flagged', r && r.groups.indexOf('All The Guys') >= 0);
  ok('  ...and said to hold a cast number',
     /cast number/.test(api.html([ch('All The Guys', 1)])));
  ['Everyone', 'Crowd', 'Both', 'The Villagers', 'Guests'].forEach(g => {
    ok('"' + g + '" is flagged too',
       (api.review([ch(g, 1), ch('Bayo', 9)]) || { groups: [] }).groups.indexOf(g) >= 0);
  });
  ok('a real person is never flagged as a group',
     api.review([ch('Bayo', 23), ch('Tayo', 4), ch('Glory', 3)]) === null);
}

// ══════════════════════════════════════════════
console.log('\nA clean cast list gets no notice at all');
{
  ok('nothing to say -> null',
     api.review([ch('Bayo', 23), ch('Toni', 23), ch('Dare', 18)]) === null);
  ok('  ...and no markup', api.html([ch('Bayo', 23), ch('Toni', 23)]) === '');
  ok('an empty list -> null', api.review([]) === null);
  ok('undefined -> null, not a crash', api.review(undefined) === null);
  ok('entries with no name are ignored',
     api.review([{ total: 1 }, { character: '', total: 2 }]) === null);
}

// ══════════════════════════════════════════════
console.log('\nIt is wired where a reader will see it');
{
  const RENDER = block('function renderWorkspaceResults');
  const a = RENDER.indexOf('Report 2'), b = RENDER.indexOf('Report 3');
  const hit = RENDER.indexOf('slateCastReviewHtml(chars)');
  ok('under Report 2, where the cast list is', hit > a && hit < b);
}

console.log('\nThe cast key is used everywhere cast is keyed');
{
  const MERGE = block('function mergeBreakdownChunks');
  ok('the character map uses it', /var k = slateCastKey\(name\)/.test(MERGE));
  ok('the canonical name map uses it',
     /slateCanonCast\[slateCastKey\(c\.character\)\]/.test(MERGE),
     'keyed differently from charMap, the two disagree and a merge undoes itself');
  ok('and the scenes are rewritten through it',
     /var k = slateCastKey\(c\)/.test(MERGE) && /var k = slateCastKey\(n\)/.test(MERGE));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
