// What the model is actually shown.
//
//   node tests/splitter-probe.js
//
// WHY THIS FILE EXISTS
//
// Until 23 November nothing tested splitScriptForProcessing. It decides
// what text the model sees, in what pieces, and it is where phantom
// scenes come from — and it had no assertions at all.
//
// Its own comment states the invariant it exists to keep:
//
//   "Cut only at scene headings, never mid-scene. A chunk boundary inside
//    a scene makes the model see two half-scenes and report them as two,
//    which is where phantom scenes come from."
//
// It kept that promise. The CALLER then broke it from outside, with a
// policy called "never reject — slice": any section over twice the limit
// was cut every CHUNK_SIZE characters, mid-sentence. On THE HILLS BETWEEN
// US that turned four sections into twelve, eight of which began nowhere
// near a heading, and the run came back with 110 scenes for 104 headings
// and 11 scenes carrying no location at all.
//
// Worse, it ran AFTER the splitter returned, so slateRecordNumbers had
// recorded 68 sections while 76 were sent: the recorded headings and the
// sections the model saw stopped describing the same text.
//
// Be accurate about why that was missed: the splitter was never wrong.
// Asserting its output would have passed, because it returned a whole
// 8698-character scene exactly as it should and the caller cut it up
// afterwards. The invariant was unassertable from here while the policy
// lived outside the function that promises it.
//
// So the fix was to move the policy in, and these assertions cover it
// now — "every section begins with a scene heading" and "the recorded
// arrays describe the sections returned". The last section of this file
// guards the other half: that no caller starts slicing again.
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}
function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
}

const win = {};
const api = new Function('window', 'console',
  ['var SLATE_HEAD =', 'var SLATE_NUM  =', 'var SLATE_CONTD_RE', 'var SLATE_SCENE_MARKER',
   'var SLATE_NUM_ONLY_SRC', 'var slateHeadingSrc', 'var SLATE_SEQUENCE',
   'var SLATE_ROWS_PER_PAGE', 'var SLATE_CHARS_PER_ROW',
   'var SLATE_MAX_SCENES_PER_CHUNK'].map(stmt).join('\n') + '\n'
  + ['function slateCleanSceneNumber', 'function slateLoneSceneNumber',
     'function slateNextNonBlank', 'function slateMarginNumberedHeading',
     'function slateNumberedSequenceHeading', 'function slateHeadTextAt',
     'function slateMontageBeat', 'function slateEndsSequence',
     'function slateSceneTypeFrom', 'function slateRowsIn',
     'function slateEighthsFromRows', 'function slateSceneNumbersIn',
     'function slateIsNotTitle', 'function slateSceneMarksIn',
     'function slateRecordNumbers', 'function slateSplitOversize',
     'function splitScriptForProcessing', 'function splitBySize'].map(block).join('\n')
  + '; return { split: splitScriptForProcessing, oversize: slateSplitOversize,'
  + ' headRe: new RegExp("^[ \\t]*(?:" + slateHeadingSrc + ")", "i"),'
  + ' maxScenes: SLATE_MAX_SCENES_PER_CHUNK };')(
  win, { warn() {}, error() {}, log() {} });

const { split, oversize, headRe, maxScenes } = api;
const startsWithHeading = (s) => headRe.test(String(s || '').trim());
const squash = (s) => String(s || '').replace(/\s+/g, '');

// A scene of a given size, with a real heading on top.
function scene(n, place, chars) {
  let body = '';
  while (body.length < chars) {
    body += 'He crosses the room and says nothing for a long moment.\n';
  }
  return n + '. INT. ' + place + ' — DAY\n\n' + body;
}

// ══════════════════════════════════════════════════
console.log('\nAn ordinary section is left alone');
{
  ok('a section inside the limit comes back untouched',
     JSON.stringify(oversize('INT. KITCHEN - DAY\n\nShe waits.', 3000))
       === JSON.stringify(['INT. KITCHEN - DAY\n\nShe waits.']));
  ok('  ...and so does one at exactly twice the limit',
     oversize('x'.repeat(6000), 3000).length === 1);
}

// ══════════════════════════════════════════════════
// THE HILLS CASE.
console.log('\nOne long scene is sent whole, however long');
{
  // The four real sections that used to be sliced were 6323, 6582, 6258
  // and 8698 characters, and every one held exactly ONE scene.
  [6323, 6582, 6258, 8698].forEach(function (size) {
    const one = scene(60, 'ADEYEMI HOUSE', size);
    const out = oversize(one, 3000);
    ok(size + ' characters of ONE scene stays one section', out.length === 1,
       out.length + ' pieces — the pieces after the first have no heading');
  });

  const out = oversize(scene(60, 'ADEYEMI HOUSE', 8698), 3000);
  ok('  ...and no text is lost', squash(out.join('\n')) === squash(scene(60, 'ADEYEMI HOUSE', 8698)));
}

console.log('\nSeveral scenes in one oversize section are cut at the headings');
{
  const many = scene(1, 'KITCHEN', 2500) + '\n' + scene(2, 'MARKET', 2500)
             + '\n' + scene(3, 'CHURCH', 2500);
  const out = oversize(many, 3000);
  ok('it was cut', out.length > 1, out.length + ' pieces');
  ok('EVERY piece begins with a scene heading',
     out.every(startsWithHeading),
     JSON.stringify(out.map(p => p.slice(0, 34))));
  ok('  ...and no text is lost', squash(out.join('\n')) === squash(many),
     'the breakdown would be missing part of the script');
}

console.log('\nA pathological scene degrades, it does not fail');
{
  // Nothing real comes close — the longest scene we have seen is 8698
  // characters — but a corrupted upload must not throw.
  const huge = scene(1, 'NOWHERE', 40000);
  const out = oversize(huge, 3000);
  ok('it is cut rather than refused', out.length > 1, out.length + ' pieces');
  ok('cut at LINE breaks, never inside a line',
     out.every(p => !/\S$/.test(p) || p === out[out.length - 1])
     || out.join('\n').split('\n').length === huge.split('\n').length,
     'a piece ending mid-sentence gives the model half a line');
  ok('  ...and still loses no text', squash(out.join('\n')) === squash(huge));
  ok('a script with no headings at all does not throw',
     Array.isArray(oversize('x'.repeat(30000), 3000)));
}

// ══════════════════════════════════════════════════
// THE TWO ASSERTIONS THAT WOULD HAVE CAUGHT IT.
console.log('\nEvery section the model is given begins at a scene heading');
{
  const script = 'THE HILLS BETWEEN US\n\nWritten by\n\nSomeone\n\n'
    + scene(1, 'KITCHEN', 400) + '\n' + scene(2, 'MARKET', 400) + '\n'
    + scene(3, 'CHURCH', 400) + '\n' + scene(4, 'RIVER', 6500) + '\n'
    + scene(5, 'CLINIC', 400) + '\n' + scene(6, 'ROAD', 400) + '\n'
    + scene(7, 'BAR', 9000) + '\n' + scene(8, 'FARM', 400);
  const chunks = split(script, 3000);

  ok('the splitter produced sections', chunks.length > 1, chunks.length + '');
  ok('EVERY section starts with a heading',
     chunks.every(startsWithHeading),
     JSON.stringify(chunks.map((c, i) => i + ':' + c.slice(0, 22))).slice(0, 300)
     + '  <- a headless section is a phantom scene');
  ok('no section holds more than the scene cap',
     chunks.every(c => (c.match(new RegExp(headRe.source, 'gim')) || []).length <= maxScenes),
     'the cap is what keeps a single call answerable');

  // Conservation. The front matter is deliberately dropped, so compare
  // from the first heading on.
  const fromFirstHeading = script.slice(script.search(/^\s*1\. INT\./m));
  ok('no text is lost between the first heading and the end',
     squash(chunks.join('\n')) === squash(fromFirstHeading),
     'a filmmaker whose script is silently truncated gets a short breakdown '
     + 'and no warning');
}

console.log('\nThe recorded headings describe the sections that were returned');
{
  // The caller's removed slicer ran AFTER the splitter, so these two
  // disagreed: 68 recorded against 76 sent. Nothing noticed, because
  // nothing asserted it.
  const script = scene(1, 'KITCHEN', 400) + '\n' + scene(2, 'MARKET', 400) + '\n'
    + scene(3, 'CHURCH', 7000) + '\n' + scene(4, 'RIVER', 400);
  const chunks = split(script, 3000);

  ok('one recorded entry per section',
     (win.slateChunkNumbers || []).length === chunks.length,
     (win.slateChunkNumbers || []).length + ' recorded vs ' + chunks.length + ' sections');
  ok('  ...and one list of headings per section',
     (win.slateChunkHeads || []).length === chunks.length,
     (win.slateChunkHeads || []).length + ' vs ' + chunks.length);
  ok('  ...and the headings recorded for a section are the ones in it',
     (win.slateChunkHeads || []).every((heads, i) =>
       heads.length === (chunks[i].match(new RegExp(headRe.source, 'gim')) || []).length),
     JSON.stringify((win.slateChunkHeads || []).map(h => h.length))
     + ' vs ' + JSON.stringify(chunks.map(c =>
         (c.match(new RegExp(headRe.source, 'gim')) || []).length)));

  const total = (win.slateChunkNumbers || []).reduce((a, b) => a + b.length, 0);
  ok('every scene in the script is accounted for once', total === 4, total + ' of 4');
}

// ══════════════════════════════════════════════════
// AND THAT NOBODY SLICES SECTIONS AGAIN SOMEWHERE ELSE.
//
// This is the half the assertions above cannot see. The splitter kept its
// promise for months while the caller broke it, and the only reason that
// was possible is that the caller is allowed to reshape the list the
// splitter returns.
console.log('\nNo caller cuts sections up on its own');
{
  // The exact shape of the removed policy: a loop slicing a chunk by
  // CHUNK_SIZE characters.
  ok('nothing slices a section by character count',
     !/\.slice\(\s*p\s*,\s*p\s*\+\s*CHUNK_SIZE\s*\)/.test(APP)
     && !/for\s*\(\s*let\s+p\s*=\s*0;\s*p\s*<\s*oversized\.length/.test(APP),
     'the "never reject — slice" policy is back, and it cuts scenes in half');

  // splitScriptForProcessing's result must be used as given. A splice on
  // it is how the sections and the recorded headings came apart.
  ok('the splitter\u2019s result is not spliced by its caller',
     !/chunks\.splice\(/.test(APP),
     'reshaping the list after slateRecordNumbers has run makes the recorded '
     + 'headings describe different text than the model was sent');

  // And the one place that is allowed to do it says so.
  ok('oversize handling lives in the splitter, before the recording',
     APP.indexOf('function slateSplitOversize') > 0
     && APP.indexOf('slateSplitOversize(chunks[sz]')
        < APP.indexOf('return slateRecordNumbers(slateSized'),
     'the recording must happen on the sections that are actually sent');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
