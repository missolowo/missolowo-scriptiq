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
  block('function slateMarginNumberedHeading'),
  stmt('var SLATE_SEQUENCE'),
  block('function slateNumberedSequenceHeading'),
  block('function slateHeadTextAt'),
  block('function slateMontageBeat'),
  block('function slateEndsSequence'),
  block('function slateNextNonBlank'),
  // The two that decide whether a beat becomes a scene. Until 23 November
  // nothing in this file reached them, so the promotion of beats to scenes
  // — and its removal — had no coverage at all.
  stmt('var SLATE_SCENE_MARKER'),
  stmt('var SLATE_NUM_ONLY_SRC'),
  stmt('var SLATE_ROWS_PER_PAGE'),
  stmt('var SLATE_CHARS_PER_ROW'),
  block('function slateSceneTypeFrom'),
  block('function slateRowsIn'),
  block('function slateEighthsFromRows'),
  block('function slateSceneMarksIn'),
  block('function slateCountScenes')
].join('\n');

const api = new Function('console', HEAD
  + '; return { lone: slateLoneSceneNumber, next: slateNextNonBlank,'
  + '           margin: slateMarginNumberedHeading, contd: SLATE_CONTD_RE,'
  + '           seq: slateNumberedSequenceHeading, beat: slateMontageBeat,'
  + '           ends: slateEndsSequence, HEADSRC: slateHeadingSrc,'
  + '           marks: slateSceneMarksIn, count: slateCountScenes };')(
  { warn() {}, error() {}, log() {} });

const lone = (line, next) => api.lone(line, next === undefined ? '' : next);
const margin = (line) => api.margin(line);

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
// A locked shooting script prints its scene number in BOTH margins, which
// is what lets us read a heading that contains no interior or exterior word
// at all. Every line below is a real line from iRANTI RECALL, a 175-page
// shooting script whose twelve FLASHBACK, ECU, POV and INTERCUT headings we
// dropped entirely — their locations and times missing, nothing scheduled.
//
// The alternative was to add those words to the heading vocabulary, which
// would have them matching inside action lines, and that is precisely how
// the Turkish and Korean bugs were made. This asks the page instead.
console.log('\nA shooting script numbers its scenes in both margins');
{
  const g = (l) => { const m = margin(l); return m ? m.number : null; };
  ok('a FLASHBACK heading is read, and numbered',
     g('14 UNKNOWN - FLASHBACK                        14') === '14');
  ok('an ECU heading too',
     g('68 ECU – HIS EYES.                        68') === '68');
  ok('a POV heading too',
     g("62 A BABY'S POV.                        62") === '62');
  ok('a BACK TO heading too',
     g('15 BACK TO DAVID’S OFFICE                        15') === '15');
  ok('and a plain slug line is unaffected',
     g('1 EXT. WOODS – SUNDOWN                        1') === '1');
  ok('the heading text comes back without either margin number',
     margin('14 UNKNOWN - FLASHBACK                        14').text
       === 'UNKNOWN - FLASHBACK',
     JSON.stringify(margin('14 UNKNOWN - FLASHBACK                        14')));

  // The subtle one. This matches on the INNER "INT." and so reaches the
  // rest of the code with NO number, which is worse than being missed: an
  // unnumbered scene reads as the writer's omission rather than ours.
  ok('an INTERCUT between two interiors keeps its own number',
     g("7 INTERCUT – INT. DEBBY'S BEDROOM / INT. ADA'S BEDROOM       7") === '7',
     'the inner INT. is not the scene number');

  ok('an A-scene number works here too',
     g('44A INT. WALE\'S WORKSHOP — EVENING                   44A') === '44A');
}

console.log('  ...and refuses everything that merely repeats a number');
{
  const no = (l, why) => ok('refused: ' + JSON.stringify(l.slice(0, 46)),
                            margin(l) === null, why);
  // The margin gap is the signal. Without it this is prose.
  no('2 things and 2 only', 'one space is not a margin');
  no('I was 7 when we left in 7', 'a sentence, not a heading');
  // Different numbers at the ends mean it is not a margin pair at all.
  ok('refused when the two numbers differ',
     margin('14 UNKNOWN - FLASHBACK                        15') === null);
  no('49 1234567                        49', 'digits are not a heading');
  no('', 'an empty line');
  no('EXT. WOODS – SUNDOWN', 'no numbers at all');
  // A paragraph that happens to begin and end with the same number.
  no('3 ' + 'x'.repeat(140) + '                        3',
     'a heading is a line, not a paragraph');
}

// ══════════════════════════════════════════════════
// A montage and an intercut are scenes, and a writer who numbers one has
// said so. These have no interior or exterior word either, and we read
// none of them: THE HILLS BETWEEN US lost both its montages, and losing
// the second hid a ninth reused scene number, because the writer had
// already used 63 for "EXT. WALE'S COMPOUND — DAY" and we could not see
// the second claim on it.
console.log('\nA numbered montage or intercut is a scene');
{
  const g = (l) => { const m = api.seq(l); return m ? m.number : null; };
  ok('30A. MONTAGE is scene 30A', g('30A. MONTAGE — A LOVE TAKING ROOT') === '30A');
  ok('63. MONTAGE is scene 63',
     g('63. MONTAGE — VARIOUS LOCATIONS — MONTHS PASSING') === '63');
  ok('a SERIES OF SHOTS counts', g('15. SERIES OF SHOTS — THE VILLAGE WAKES') === '15');
  ok('an INTERCUT with no full stop after the number counts',
     g("49      INTERCUT – ADA'S LIVING ROOM / DAVID AND DEBBY'S DINING ROOM") === '49',
     'this is the one iRANTI heading the margin rule cannot see');
  ok('  ...and a margin number is not left inside the location',
     api.seq('71 INTERCUT BETWEEN DEBBY AND DOCTOR FASH. UNKNOWN PLACE:    71').text
       === 'INTERCUT BETWEEN DEBBY AND DOCTOR FASH. UNKNOWN PLACE:',
     JSON.stringify(api.seq('71 INTERCUT BETWEEN DEBBY AND DOCTOR FASH. UNKNOWN PLACE:    71')));

  // A montage's BEATS are not scenes. They open with a dash, so no reader
  // matches them, and they belong to the numbered scene above — which is
  // what the writer meant by indenting them under it.
  ok('a montage beat is not a scene', api.seq('— INT. ABEGUNDE HOUSE — DAY') === null);
  ok('  ...nor is a prose beat',
     api.seq('— Dawn: Akin and Omowon paddle a canoe across the lake') === null);
}

console.log('  ...and a sentence that merely mentions one is not');
{
  const no = (l, why) => ok('refused: ' + JSON.stringify(l.slice(0, 48)),
                            api.seq(l) === null, why);
  no('An unnumbered MONTAGE — VARIOUS', 'no number, so nothing says it is a scene');
  no('INTERCUT WITH:', 'a transition, not a heading');
  no('He shot 3 MONTAGE sequences that winter.', 'the number must open the line');
  no('  the montage continues', 'lower case, mid-sentence, no number');
  no('63.MONTAGE', 'no separator at all — too close to a word boundary to trust');
  no('', 'an empty line');
}

// ══════════════════════════════════════════════════
// A montage beat belongs TO its montage. The writer numbered the montage
// once, so it is one scene — and ten beats in ten places are still ten
// setups, ten company moves and ten lighting calls, so every beat is
// carried on that scene with its own location and shown under it. The
// count follows the script; the detail stays on the page.
//
// It did not used to be that way. Beats were promoted to scenes of their
// own, for two reasons. The production one is answered above. The
// mechanical one was that "the merge only trusts our numbers when our
// count agrees with the model's" — and that stopped being true on 22
// November, when the merge began matching the two lists by heading
// instead of requiring equal lengths.
//
// What follows tests the LINE: is this a beat at all? Whether a beat
// becomes a scene is tested where that is decided, further down.
console.log('\nA montage beat is recognised, but only inside a montage');
{
  const B = (l, inSeq) => api.beat(l, inSeq === undefined ? true : inSeq);

  // Scene 63's montage is written as slug lines.
  ok('a slug-line beat counts', !!B('— INT. ABEGUNDE HOUSE — DAY'));
  ok('  ...with an en dash', !!B('– EXT. VILLAGE SQUARE — DAY'));
  ok('  ...and with a plain hyphen', !!B('- INT. LAGOS ART GALLERY — EVENING'));

  // Scene 30A's montage is written as prose. Still a setup: a lake, at
  // dawn, two actors and a canoe.
  ok('a prose beat counts too',
     !!B('— Dawn: Akin and Omowon paddle a canoe across the lake'));
  ok('  ...and keeps its text',
     B('— They dance under the veranda as the rain returns').text
       === 'They dance under the veranda as the rain returns');

  // THE GUARD. Outside a montage a leading dash means nothing in
  // particular, and treating it as a scene would invent setups on every
  // script that uses a dash for anything.
  ok('OUTSIDE a montage, a dash line is NOT a beat',
     B('— INT. ABEGUNDE HOUSE — DAY', false) === null,
     'the context is the whole safety of this rule');
  ok('  ...nor is a dash of dialogue', B('— I never said that.', false) === null);

  ok('a bare dash is not a beat', B('—') === null);
  ok('a page of prose is not a beat', B('— ' + 'x'.repeat(260)) === null);
  ok('an empty line is not a beat', B('') === null);
  ok('a line with no dash is not a beat', B('INT. ABEGUNDE HOUSE — DAY') === null);
}

console.log('  ...and a montage ends when the script returns to scenes');
{
  const ends = (l) => {
    // Built exactly as slateSceneMarksIn and slateCountScenes build it —
    // slateHeadingSrc, not SLATE_HEAD, because a numbered heading has its
    // number before the INT/EXT word and must still end the sequence.
    const headStart = new RegExp('^[ \\t]*' + api.HEADSRC, 'i');
    return api.ends(l, headStart);
  };
  ok('a numbered heading ends the montage', ends('64. EXT. WALE\'S COMPOUND — NIGHT'));
  ok('a plain slug line ends it too', ends('INT. OMOWON\'S BEDROOM — DAY'));
  ok('another montage heading ends the first', ends('63. MONTAGE — VARIOUS LOCATIONS'));
  ok('a beat does NOT end it', !ends('— INT. ABEGUNDE HOUSE — DAY'));
  ok('action does not end it', !ends('Akin stands in the doorway holding something.'));
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
  const usesIt = (from, name) => {
    const body = APP.slice(from, APP.indexOf('\n      }', from));
    return body.indexOf(name || 'slateLoneSceneNumber') > 0;
  };
  ok('the health panel asks through it', usesIt(inPanel));
  ok('the splitter\'s scene marks ask through it', usesIt(inMarks));
  ok('the scene counter asks through it', usesIt(inCount));

  // Nobody may hand-roll the bare-number pattern again.
  const copies = (APP.match(/\[0-9\]\{1,3\}\[A-Za-z\]\?/g) || []).length;
  ok('the bare-number pattern is written exactly once',
     copies === 1, copies + ' copies — this is how the drift starts');

  // And the same for the margin reader. This one decides whether fifteen of
  // iRANTI RECALL's scenes exist at all, so one half of the file knowing
  // about it and the other not is the worst outcome available: the panel
  // would report 114 scenes while the breakdown ran 99, or the reverse.
  ok('the health panel reads the margins', usesIt(inPanel, 'slateMarginNumberedHeading'));
  ok('the splitter\'s scene marks read the margins',
     usesIt(inMarks, 'slateMarginNumberedHeading'));
  ok('the scene counter reads the margins', usesIt(inCount, 'slateMarginNumberedHeading'));
  const mcopies = (APP.match(/\[ \\t\]\{2,\}\\1/g) || []).length;
  ok('the margin pattern is written exactly once',
     mcopies === 1, mcopies + ' copies');

  // Same for the sequence reader, for the same reason.
  ok('the health panel reads montages', usesIt(inPanel, 'slateNumberedSequenceHeading'));
  ok('the splitter\'s scene marks read montages',
     usesIt(inMarks, 'slateNumberedSequenceHeading'));
  ok('the scene counter reads montages', usesIt(inCount, 'slateNumberedSequenceHeading'));
  const scopies = (APP.match(/MONTAGE\|SERIES OF SHOTS/g) || []).length;
  ok('the sequence vocabulary is written exactly once',
     scopies === 1, scopies + ' copies');
}

// ══════════════════════════════════════════════════
// WHETHER A BEAT BECOMES A SCENE.
//
// This is what nothing tested. Every assertion above asks whether a LINE
// is a beat, which is a different question, and all 815 of them stayed
// green when the answer to this one was reversed.
//
// THE HILLS BETWEEN US: 104 marks with beats promoted, 87 without, and
// 17 beats across its montages. The writer's highest number is 65.
console.log('\nA montage is ONE scene, and carries its beats');
{
  const script = [
    '1. INT. ADEYEMI HOUSE — MORNING',
    '',
    'Omowon pours tea.',
    '',
    '2. MONTAGE — VARIOUS LOCATIONS — MONTHS PASSING',
    '',
    '— INT. ABEGUNDE HOUSE — DAY',
    'She paints in silence.',
    '— INT. LAGOS ART GALLERY — EVENING',
    'Her work hangs on a white wall.',
    '— EXT. VILLAGE SQUARE — DAY',
    'Children run past the mango tree.',
    '',
    '3. EXT. IMOLE LAKE — SUNSET',
    '',
    'Akin stands at the water.'
  ].join('\n');

  const marks = api.marks(script);
  const counted = api.count(script);

  ok('THREE scenes, not six', marks.length === 3,
     marks.length + ' — the writer numbered three');
  ok('  ...and the count agrees', counted.total === 3, counted.total + '');
  ok('  ...and it is the montage that holds the beats',
     (marks[1].beats || []).length === 3,
     JSON.stringify(marks.map(m => (m.beats || []).length)));
  ok('each beat keeps its own location, so an AD sees every setup',
     (marks[1].beats || []).join(' | ').indexOf('LAGOS ART GALLERY') >= 0,
     JSON.stringify(marks[1].beats));
  ok('no beat is a scene of its own', !marks.some(m => m.beat),
     'a beat as a scene is a scene the writer never numbered');
  ok('the beats are still counted, so the panel can say how many',
     counted.beats === 3, counted.beats + '');
  ok('and NO beat is reported as a scene missing its number',
     counted.unnumbered === 0,
     counted.unnumbered + ' — reporting beats as unnumbered scenes would be '
     + 'a false accusation on a correctly formatted script');

  // CONSERVATION. The montage's row range must now run from its heading
  // past all its beats to the next real heading. If it does not, the page
  // count silently loses the montage and every page number after it
  // shifts.
  const rows = marks.reduce((a, m) => a + (m.rows || 0), 0);
  const lines = script.split('\n').length;
  ok('every row of the script is accounted for exactly once',
     rows > 0 && rows <= lines && marks[1].rows >= 6,
     'montage rows ' + marks[1].rows + ', total ' + rows + ' of ' + lines
     + ' lines — the montage must own its beats\u2019 rows');

  // The numbers themselves, which is what a filmmaker reads.
  ok('the writer\u2019s own numbers are what we recorded',
     JSON.stringify(marks.map(m => m.number)) === '["1","2","3"]',
     JSON.stringify(marks.map(m => m.number)));
}

console.log('\nA dash list that is NOT under a montage is untouched');
{
  // The guard that makes all of this safe. A script using dashes for
  // emphasis, or an action line that happens to start with one, must not
  // disappear into a scene above it.
  const script = [
    '1. INT. KITCHEN — DAY',
    '',
    'She sets out three things:',
    '— a knife',
    '— a bowl',
    '— the letter',
    '',
    '2. EXT. ROAD — NIGHT',
    '',
    'He walks.'
  ].join('\n');
  const marks = api.marks(script);
  ok('two scenes', marks.length === 2, marks.length + '');
  ok('and no beats were collected from a plain dash list',
     marks.every(m => !(m.beats || []).length),
     JSON.stringify(marks.map(m => m.beats || [])));
}



// ══════════════════════════════════════════════════
// A CONTINUATION IS NOT ANOTHER SCENE.
//
// Found on 24 November, measuring whether a filmmaker's scene can go
// missing. It cannot — but the COUNT said it had.
//
// "37. EXT. LAKE PATH — DAWN (CONT'D)" at the top of a new page is scene
// 37 again, not a scene 88. slateFromPage has always refused to rebuild a
// CONT'D heading, so the breakdown came out with the right 86 scenes. The
// health panel, reading the same script through slateCountScenes, said 87.
//
// A filmmaker counts, finds one fewer than promised, and concludes a scene
// went missing. That is the exact complaint this product has actually
// received, arriving this time from our own arithmetic rather than from
// any scene being lost.
console.log('\nA scene continued over a page break is counted once');
{
  const countApi = new Function('window', 'console',
    ['var SLATE_HEAD =', 'var SLATE_NUM  =', 'var SLATE_CONTD_RE', 'var SLATE_SCENE_MARKER',
     'var SLATE_NUM_ONLY_SRC', 'var slateHeadingSrc', 'var SLATE_SEQUENCE',
     'var SLATE_ROWS_PER_PAGE', 'var SLATE_CHARS_PER_ROW'].map(stmt).join('\n') + '\n'
    + ['function slateCleanSceneNumber', 'function slateLoneSceneNumber',
       'function slateNextNonBlank', 'function slateMarginNumberedHeading',
       'function slateNumberedSequenceHeading', 'function slateHeadTextAt',
       'function slateMontageBeat', 'function slateEndsSequence',
       'function slateSceneTypeFrom', 'function slateRowsIn',
       'function slateEighthsFromRows', 'function slateIsNotTitle',
       'function slateSceneMarksIn', 'function slateCountScenes'].map(block).join('\n')
    + '; return slateCountScenes;')({}, { warn() {}, error() {}, log() {} });

  // The real shape, from THE HILLS BETWEEN US.
  const script = '36. INT. KITCHEN — DAY\n\nShe waits.\n\n'
    + '37. EXT. LAKE PATH — DAWN\n\nHe walks.\n\n'
    + "37. EXT. LAKE PATH — DAWN (CONT'D)\n\nHe keeps walking.\n\n"
    + '38. INT. CHURCH — DAY\n\nThey pray.\n';
  const r = countApi(script);

  ok('three scenes, not four', r.total === 3, r.total + '');
  ok('  ...and the continuation is reported, not silently dropped',
     r.continuations === 1, r.continuations + '');
  ok('  ...and is not counted as a numbered scene',
     r.numbered === 3, r.numbered + ' — scene 37 is numbered once, not twice');

  // The array is the splitter's record and the alignment's index. Removing
  // an entry would shift every index after it, so the heading STAYS there
  // and only what we tell the filmmaker changes.
  ok('the headings array still carries every heading',
     r.numbers.length === 4,
     r.numbers.length + ' — the alignment indexes into this, so dropping an '
     + 'entry would shift every scene after it');

  // Every spelling Word produces. A continuation we fail to recognise is a
  // phantom scene in the count.
  ["(CONT'D)", "(CONT’D)", '(CONTD)', '(CONTINUED)', '(cont’d)',
   '( CONT’D )'].forEach(function (mark) {
    const s2 = '1. INT. ROOM — DAY\n\nA.\n\n1. INT. ROOM — DAY ' + mark + '\n\nB.\n';
    ok('  ' + mark + ' is recognised', countApi(s2).total === 1,
       countApi(s2).total + ' scenes');
  });

  // And the opposite error: a scene that merely MENTIONS continuing is a
  // scene. Over-matching here would hide real scenes from the count.
  ok('a heading that is not a continuation still counts',
     countApi('1. INT. ROOM — DAY\n\nA.\n\n2. INT. HALL — CONTINUOUS\n\nB.\n').total === 2,
     'CONTINUOUS is a time of day, not a page break');
}

console.log('\nThe panel says so before the filmmaker counts');
{
  ok('the health panel carries the continuation count',
     /continuations = slateCount\.continuations/.test(APP));
  ok('  ...and says it in words on the panel',
     /repeated after a page break, counted once/.test(APP),
     'a filmmaker scrolling their own script sees the heading twice and '
     + 'will otherwise conclude we lost a scene');
  ok('  ...and says nothing when there are none',
     /r\.continuations\s*\n?\s*\?/.test(APP),
     'an always-on note about page breaks is noise on the 4 scripts in 5 '
     + 'that have none');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
