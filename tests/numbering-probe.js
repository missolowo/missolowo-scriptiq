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

function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
}

// SLATE_NO_NUMBER is extracted rather than written out here, so that the
// character the note explains and the character the labels print can never
// become two different characters.
const SRC = stmt('var SLATE_NO_NUMBER') + '\n'
  + block('function slateNumberingNote') + '\n' + block('function slateNumberingNoteHtml');
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

// ══════════════════════════════════════════════
// The dash is now the LABEL of every scene we could not place, not just a
// word in a footnote — it prints in the scene column of every PDF, in
// every script we support. A font without the glyph draws a box there.
console.log('\nEvery embedded font can actually draw the dash');
{
  const fonts = fs.readdirSync(ROOT).filter(f => /\.ttf$/.test(f));
  ok('the fonts are where the PDF builder expects them', fonts.length > 0,
     'no .ttf files found in the repository root');

  // Minimal cmap walk: formats 4 and 12 are all jsPDF's Noto files use.
  const hasGlyph = (file, cp) => {
    const d = fs.readFileSync(__p.join(ROOT, file));
    let cmap = null;
    for (let i = 0; i < d.readUInt16BE(4); i++) {
      const rec = 12 + 16 * i;
      if (d.slice(rec, rec + 4).toString('latin1') === 'cmap') cmap = d.readUInt32BE(rec + 8);
    }
    if (cmap === null) return false;
    for (let i = 0; i < d.readUInt16BE(cmap + 2); i++) {
      const sub = cmap + d.readUInt32BE(cmap + 4 + 8 * i + 4);
      const fmt = d.readUInt16BE(sub);
      if (fmt === 4) {
        const segX2 = d.readUInt16BE(sub + 6);
        for (let j = 0; j < segX2 / 2; j++) {
          const end = d.readUInt16BE(sub + 14 + 2 * j);
          const start = d.readUInt16BE(sub + 16 + segX2 + 2 * j);
          if (start <= cp && cp <= end) return true;
        }
      } else if (fmt === 12) {
        const n = d.readUInt32BE(sub + 12);
        for (let g = 0; g < n; g++) {
          const gp = sub + 16 + 12 * g;
          if (d.readUInt32BE(gp) <= cp && cp <= d.readUInt32BE(gp + 4)) return true;
        }
      }
    }
    return false;
  };

  for (const f of fonts) {
    ok('  ' + f + ' has the em dash', hasGlyph(f, 0x2014),
       'a Yoruba, Korean or Hindi breakdown would print a box in the scene column');
  }
}

console.log('\nWe still do not renumber anyone’s script');
{
  // RUN it, rather than grep it. This block used to assert that the source
  // contained the characters "return '#' + s.scene_index;" — which says
  // nothing about what a filmmaker reads, and went red the moment the line
  // was rewritten while still behaving correctly.
  const run = new Function(
    stmt('var SLATE_NO_NUMBER') + '\n'
    + block('function slateCleanSceneNumber') + '\n'
    + block('function slateSceneNumberOrNull') + '\n'
    + block('function labelFor')
    + '; return labelFor;')();

  const numbered = { scene_number: '24A', scene_index: 36 };
  const blank = { scene_number: null, scene_index: 36 };

  ok('the script’s own number prints, on either kind of script',
     run(numbered, true) === '24A' && run(numbered, false) === '24A',
     'an AD holding the script must be able to find the scene');
  ok('  ...trailing punctuation the model copied off the heading is cleaned',
     run({ scene_number: '12.', scene_index: 1 }, true) === '12',
     run({ scene_number: '12.', scene_index: 1 }, true));

  // The producer's complaint, as an assertion. His script numbers its own
  // scenes; "#36" between "24H" and "26" is a number nowhere on his pages.
  ok('ON A NUMBERED SCRIPT an unplaced scene shows a dash, never a number of ours',
     run(blank, true) === '\u2014',
     JSON.stringify(run(blank, true))
     + '  <- anything number-shaped here is the bug he reported');

  // And the other half: where there is no number space to collide with,
  // "#36" is useful and stays.
  ok('on a script that numbers nothing, our position is still the fallback',
     run(blank, false) === '#36', run(blank, false));

  ok('a scene numbered "0" is a number, not an absence',
     run({ scene_number: '0', scene_index: 9 }, true) === '0',
     run({ scene_number: '0', scene_index: 9 }, true));
  ok('the strings "null" and "undefined" are absences, not numbers',
     run({ scene_number: 'null', scene_index: 9 }, true) === '\u2014'
     && run({ scene_number: 'undefined', scene_index: 9 }, true) === '\u2014');
}

console.log('\nThe panel and the labels answer to one definition');
{
  const isNumbered = new Function(
    block('function slateScriptIsNumbered') + '; return slateScriptIsNumbered;')();

  ok('a script with 74 numbered and 30 not is a numbered script',
     isNumbered(74, 30) === true);
  ok('a script with nothing numbered is not',
     isNumbered(0, 104) === false);
  ok('four numbers in a whole feature is an accident, not a habit',
     isNumbered(4, 100) === false);
  ok('  ...but five is a habit, if they are a fifth of the scenes',
     isNumbered(5, 15) === true);
  ok('five numbers across two hundred scenes is still not a numbered script',
     isNumbered(5, 195) === false,
     'otherwise two hundred dashes print where #1..#200 would have helped');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
