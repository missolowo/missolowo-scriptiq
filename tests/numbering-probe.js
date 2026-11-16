// What the # in front of a scene number means, and whether we say so.
//
// labelFor() prints the script's own scene number when the script has one,
// and '#' plus our position when it does not. Two numbering systems sharing
// one number space. Until 16 November nothing on the page explained that.
//
// A producer's character report read "Bayo - #1, 1, #3, #4, ... 9, 12, 14,
// #19" with no way to tell whether #1 and 1 were one scene or two. He was
// pleased with the breakdown and never mentioned it. Elizabeth found it.
//
// The mixed case is the dangerous one: in a script that numbers some scenes
// and not others, "#11" is our eleventh scene and "11" is the scene the
// script calls 11. Two different scenes, and a 1st AD looking up "scene 11"
// finds both.
//
// We do not renumber: replacing the script's own numbers would leave
// somebody holding the script unable to find the scene. We explain instead,
// and these assertions are what keep the explanation there.
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

const SRC = block('function slateNumberingNote') + '\n' + block('function slateNumberingNoteHtml');
const api = new Function(SRC + '; return { note: slateNumberingNote, html: slateNumberingNoteHtml };')();
const plain = t => (t || '').replace(/<[^>]+>/g, '');

const label = l => ({ scene_label: l });

// ══════════════════════════════════════════════
console.log('\nA cleanly numbered script gets no footnote');
{
  ok('every scene numbered by the script -> nothing to explain',
     api.note([label('1'), label('2'), label('3')]) === null);
  ok('  ...and no markup is emitted either',
     api.html([label('1'), label('2')]) === '');
  ok('no scenes at all -> nothing', api.note([]) === null);
  ok('undefined -> nothing, not a crash', api.note(undefined) === null);
  ok('scenes with no labels at all -> nothing',
     api.note([{}, {}]) === null);
}

// ══════════════════════════════════════════════
console.log('\nAn unnumbered script is told the numbers are ours');
{
  const n = plain(api.note([label('#1'), label('#2'), label('#3')]));
  ok('it says so', /does not number its scenes/.test(n), n);
  ok('  ...and explains what # counts', /first scene/.test(n) && /second/.test(n), n);
  ok('  ...without warning about a collision that cannot happen',
     !/different scenes/.test(n),
     'nothing can collide when every label is ours');
  ok('  ...and renders in the quiet style, not the warning style',
     !/--warn/.test(api.html([label('#1')])));
}

// ══════════════════════════════════════════════
console.log('\nA mixed script gets the warning, because two scenes can collide');
{
  const n = plain(api.note([label('#1'), label('1'), label('#3'), label('9')]));
  ok('it names the problem', /numbers some scenes and not others/.test(n), n);
  ok('  ...says which numbers are ours', /with a # are ours/.test(n), n);
  ok('  ...says the two are DIFFERENT scenes',
     /different scenes/.test(n),
     'this is the sentence that stops an AD calling the wrong scene');
  ok('  ...shows the collision concretely', /#11/.test(n) && /calls 11/.test(n), n);
  ok('  ...and tells them how to remove it',
     /Numbering every scene/.test(n), n);
  ok('  ...and renders in the warning style',
     /--warn/.test(api.html([label('#1'), label('1')])));
}

// ══════════════════════════════════════════════
console.log('\nOne of each is enough to count as mixed');
{
  // The collision needs only one scene of each kind. A script 99% numbered
  // is still ambiguous for the one that is not.
  const n = plain(api.note([label('1'), label('2'), label('3'), label('#4')]));
  ok('a single unnumbered scene among many still warns',
     /different scenes/.test(n), n);
}

// ══════════════════════════════════════════════
console.log('\nIt reaches the reader in every place the numbers do');
// Asserted by POSITION rather than by distance. A fixed character window
// kept failing on Report 2 purely because the table that sits between the
// heading and the note is longer there — the code was right every time.
function between(src, after, before, needle) {
  const a = src.indexOf(after);
  const b = before ? src.indexOf(before, a) : src.length;
  if (a < 0) return false;
  const hit = src.indexOf(needle, a);
  return hit > a && (b < 0 || hit < b);
}
const RENDER = block('function renderWorkspaceResults');
ok('under Report 2 on screen',
   between(RENDER, 'Report 2', 'Report 3', 'slateNumberingNoteHtml(data.scenes)'));
ok('under Report 3 on screen',
   between(RENDER, 'Report 3', 'Report 4', 'slateNumberingNoteHtml(data.scenes)'));
// Scoped to the export function. "Report 2" appears on screen as well, and
// an unscoped search matched that one first and then found no PDF call near
// it — the test failing while the code was right.
const EXPORT = block('async function slateExportBreakdown');
ok('in the PDF, under Report 2',
   between(EXPORT, 'Report 2', 'Report 3', 'slatePdfNumberingNote(pdf, scenes)'),
   'the PDF is the copy that reaches set');
ok('in the PDF, under Report 3',
   between(EXPORT, 'Report 3', 'Report 4', 'slatePdfNumberingNote(pdf, scenes)'));

console.log('\nThe PDF version survives the fonts we register');
{
  const pdfFn = block('function slatePdfNumberingNote');
  ok('markup is stripped before it reaches jsPDF', /replace\(\/<\[\^>\]\+>\/g, ''\)/.test(pdfFn));
  // Matched on the characters themselves, not on \u escapes. The source
  // carries the literal em dash and apostrophe, which read better in a
  // regex anyway; asserting on the escape form failed while the code was
  // correct.
  ok('  ...and the em dash with it',
     pdfFn.indexOf('—') !== -1,
     'some registered non-Latin fonts draw it as a box');
  ok('  ...and the curly apostrophe', pdfFn.indexOf('’') !== -1);
  ok('it prints nothing when there is nothing to explain',
     /if \(!note\) return;/.test(pdfFn));
}

console.log('\nWe still do not renumber anyone’s script');
{
  const labelFor = block('function labelFor');
  ok('the script’s own number is still what prints when it has one',
     /return n;/.test(labelFor));
  ok('  ...and our position is only the fallback',
     /return '#' \+ s\.scene_index;/.test(labelFor),
     'an AD holding the script must be able to find the scene');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
