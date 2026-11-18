// A scene number on a line of its own, and who it belongs to.
//
//   node tests/scenenumber-probe.js
//
// Six places in app.html used to ask "is this line nothing but a scene
// number?", each with its own copy of the pattern. The copies drifted apart
// twice — once on Turkish, once on Korean — and each time the breakdown ran
// correctly while the panel told the filmmaker we could not read their
// screenplay. They now all ask slateLoneSceneNumber, and this file is what
// holds that single answer still.
//
// The question is harder than it looks because a bare number on its own
// line is also exactly what a page number looks like. THE HILLS BETWEEN US
// contains both, four pages apart:
//
//     21                        3.
//     EXT. LAKE — SUNSET        SCENE 3
//                               EXT. IMOLE VILLAGE ROAD — AFTERNOON
//
// The first is scene 21. The second is the footer of page 3 sitting above
// the one place in 215 pages where that writer used a SCENE marker. The
// first version of this function folded both, so the page number swallowed
// the marker, scene 3's real heading was left unnumbered, AND a phantom
// scene appeared in the count. Every rejection case below is there because
// of a real line in a real screenplay.
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
function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
}

// Extracted by name from app.html, so a rename breaks this loudly rather
// than letting it pass against a stale copy.
const HEAD = [
  stmt('var SLATE_HEAD ='),
  stmt('var SLATE_NUM  ='),
  stmt('var SLATE_CONTD_RE'),
  stmt('var SLATE_SCENE_MARKER'),
  stmt('var SLATE_NUM_ONLY_SRC'),
  stmt('var slateHeadingSrc'),
  block('function slateCleanSceneNumber'),
  block('function slateLoneSceneNumber'),
  block('function slateNextNonBlank')
].join('\n');

const api = new Function('console', HEAD
  + '; return { lone: slateLoneSceneNumber, next: slateNextNonBlank,'
  + '           contd: SLATE_CONTD_RE };')({ warn() {}, error() {}, log() {} });

const lone = (line, next) => api.lone(line, next === undefined ? '' : next);

// ══════════════════════════════════════════════════
console.log('\nA number that announces itself needs no corroboration');
{
  ok('SCENE 5 is scene 5', (lone('SCENE 5') || {}).number === '5');
  ok('  ...with or without a full stop', (lone('Scene 12.') || {}).number === '12');
  ok('  ...and is not marked bare', lone('SCENE 5').bare === false);
  ok('S#12 is scene 12', (lone('S#12.') || {}).number === '12');
  ok('a Russian СЦЕНА 4 is scene 4', (lone('СЦЕНА 4') || {}).number === '4');
  ok('a Korean 씬 7 is scene 7', (lone('씬 7') || {}).number === '7');
  ok('a trailing marker is kept as the note',
     /FLASHBACK/i.test(String((lone('Scene 36 (FLASHBACK)') || {}).note)),
     JSON.stringify(lone('Scene 36 (FLASHBACK)')));
  // It needs no next line at all: that is the difference from a bare number.
  ok('it counts with nothing beneath it', !!lone('SCENE 9', ''));
}

console.log('\nA BARE number counts only when a slug line follows it');
{
  // THE HILLS BETWEEN US, scenes 21 and 56. The second sits under a CUT TO:.
  ok('21 above EXT. LAKE — SUNSET is scene 21',
     (lone('21', 'EXT. LAKE — SUNSET') || {}).number === '21');
  ok('56. above INT. POLICE STATION — DAY is scene 56',
     (lone('56.', 'INT. POLICE STATION — VISITING AREA — DAY') || {}).number === '56');
  ok('  ...and IS marked bare, so callers can tell',
     lone('21', 'EXT. LAKE — SUNSET').bare === true);
  ok('an A-scene number survives on its own line',
     (lone('44A.', 'INT. WALE\'S WORKSHOP — EVENING') || {}).number === '44A');
  ok('INTERIOR spelled out is a slug line too',
     !!lone('8', 'INTERIOR/DAY/KITCHEN'));
  ok('a blank line between them is fine',
     (lone('21', 'EXT. LAKE — SUNSET') || {}).number === '21');
}

// ══════════════════════════════════════════════════
console.log('\nTHE ONES THAT MUST BE REFUSED: page numbers');
{
  ok('a bare number with nothing beneath it is refused',
     lone('21', '') === null, JSON.stringify(lone('21', '')));
  ok('a bare number above ACTION is refused',
     lone('207', 'Akin pockets the phone.') === null);
  ok('a bare number above DIALOGUE is refused',
     lone('88', 'I came back because I cannot let an innocent man') === null);

  // The page-49 footer, directly above page 50's first heading once the page
  // break is gone. The heading already says which scene it is.
  ok('a page number above a NUMBERED heading is refused',
     lone('49', '20. EXT. THE CALABASH — LATE AFTERNOON') === null,
     JSON.stringify(lone('49', '20. EXT. THE CALABASH — LATE AFTERNOON')));

  // The one that cost a phantom scene. "3." is page 3's footer; "SCENE 3"
  // is the marker it was about to swallow.
  ok('a page number above a SCENE marker is refused',
     lone('3.', 'SCENE 3') === null,
     JSON.stringify(lone('3.', 'SCENE 3')));
  ok('  ...so the marker is still free to claim its own heading',
     (lone('SCENE 3', 'EXT. IMOLE VILLAGE ROAD — AFTERNOON') || {}).number === '3');

  ok('a four-figure number is not a scene number',
     lone('1984', 'EXT. LAKE — SUNSET') === null);
  ok('a year in dialogue is refused',
     lone('1999', 'He was born here.') === null);
  ok('an empty line is not a scene number', lone('', 'EXT. LAKE — DAY') === null);
  ok('a line of text is not a scene number',
     lone('CUT TO:', 'EXT. LAKE — DAY') === null);
  // INTERVIEWER is a character cue. The lookahead that stops it matching
  // INT exists in SLATE_HEAD and must still be honoured here.
  ok('a character cue beginning INT... is not a slug line',
     lone('14', 'INTERVIEWER') === null, JSON.stringify(lone('14', 'INTERVIEWER')));
}

console.log('\nAnd the blank-line walk');
{
  const L = ['21', '', '   ', 'EXT. LAKE — SUNSET', 'The sun sets.'];
  const n = api.next(L, 1);
  ok('it skips blank and whitespace-only lines', n.index === 3, JSON.stringify(n));
  ok('  ...and returns the text it landed on', n.text === 'EXT. LAKE — SUNSET');
  const e = api.next(L, 5);
  ok('past the end it returns an empty string', e.text === '', JSON.stringify(e));
  ok('  ...and an index past the end', e.index === 5);
}

// ══════════════════════════════════════════════════
console.log('\nA scene continuing over a page break is NOT a duplicate');
{
  const C = api.contd;
  // HILLS scene 37: "EXT. LAKE PATH — DAWN" then the same with (CONT'D).
  ok("(CONT'D) is recognised", C.test("37. EXT. LAKE PATH — DAWN (CONT'D)"));
  ok('  ...with a curly apostrophe', C.test('37. EXT. LAKE PATH — DAWN (CONT’D)'));
  ok('  ...spelled (CONTINUED)', C.test('37. EXT. LAKE PATH — DAWN (CONTINUED)'));
  ok('  ...or bare (CONT)', C.test('37. EXT. LAKE PATH — DAWN (CONT)'));
  ok('  ...or as a CONTINUED: footer', C.test('CONTINUED:'));

  // The near-misses. CONTINUOUS is a time of day and appears on a great many
  // real headings; treating it as a continuation would hide real duplicates.
  ok('CONTINUOUS is NOT a continuation marker',
     !C.test('14. INT. ABANDONED COCOA BARN — CONTINUOUS'),
     'it is a time of day, on dozens of real headings');
  ok('  ...nor is CONTINENTAL', !C.test('INT. CONTINENTAL HOTEL — DAY'));
  ok('a plain heading is not one either', !C.test('37. EXT. LAKE PATH — DAWN'));
}

// ══════════════════════════════════════════════════
// The pair. The panel reads headings through one regex and the splitter
// through another, and teaching one and not the other is how Turkish and
// Korean broke. Both now route the lone-number question through the shared
// helper, and this asserts that neither keeps a private copy of it.
console.log('\nBoth halves ask the same question');
{
  const callers = (APP.match(/slateLoneSceneNumber\(/g) || []).length;
  ok('slateLoneSceneNumber has several callers, not one',
     callers >= 5, callers + ' occurrences including its definition');

  const inPanel = APP.indexOf('function slateHealthCheck');
  const inMarks = APP.indexOf('function slateSceneMarksIn');
  const inCount = APP.indexOf('function slateCountScenes');
  const usesIt = (from) => {
    const body = APP.slice(from, APP.indexOf('\n      }', from));
    return body.indexOf('slateLoneSceneNumber') > 0;
  };
  ok('the health panel asks through it', usesIt(inPanel));
  ok('the splitter\'s scene marks ask through it', usesIt(inMarks));
  ok('the scene counter asks through it', usesIt(inCount));

  // Nobody may hand-roll the bare-number pattern again.
  const copies = (APP.match(/\[0-9\]\{1,3\}\[A-Za-z\]\?/g) || []).length;
  ok('the bare-number pattern is written exactly once',
     copies === 1, copies + ' copies — this is how the drift starts');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
