// A scene the script never numbered, and the sentence that says so.
//
//   node tests/unnumbered-probe.js
//
// WHY THIS FILE EXISTS
//
// A scene whose number the script never gave prints as "—" on every
// document. That is the right answer: a scene number is what a crew calls
// a scene by on set, and a number Slate invented would be read down a
// phone and written on a clapperboard as though the writer had chosen it.
//
// THE HILLS BETWEEN US has fifteen headings its writer did not number, so
// this is not a rare shape. What was missing was the sentence. A dash with
// no explanation reads as Slate failing to read the page, and a 1st AD
// seeing one in the shooting order cannot tell which it is.
//
// Elizabeth chose this over deriving a number: keep the dash, say why once.
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
  let d = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') d++;
    else if (APP[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}

const note = new Function(block('function slateUnnumberedNote') + '; return slateUnnumberedNote;')();

const sc = (label, number) => ({ scene_label: label, scene_number: number });

console.log('\nIt counts the scenes the script did not number');
{
  ok('a numbered script says nothing at all',
     note([sc('1', '1'), sc('2', '2')]) === '',
     'a sentence on every breakdown would train people to skim past it');
  ok('one unnumbered scene is named in the singular',
     /^One scene is not numbered/.test(note([sc('1', '1'), sc(null, null)])),
     note([sc('1', '1'), sc(null, null)]));
  ok('three are counted',
     /^3 scenes are not numbered/.test(
       note([sc('1', '1'), sc(null, null), sc('', ''), sc(null, undefined)])),
     note([sc('1', '1'), sc(null, null), sc('', ''), sc(null, undefined)]));
}

console.log('\nIt agrees with what the documents actually print');
{
  // The renderers print a dash when scene_label is falsy AND scene_number
  // is null. If this counted a different set, the sentence would say three
  // and the page would show five.
  ok('the literal dash counts as unnumbered',
     /^One scene is not numbered/.test(note([sc('1', '1'), sc('—', null)])),
     'the merge writes "—" into scene_label for a heading with no number, '
     + 'so a count that only looked for empty strings would miss every one');
  ok('  ...and so do the strings "null" and "undefined"',
     /^2 scenes/.test(note([sc('null', 'null'), sc('undefined', 'undefined')])),
     'those reach the field as text, not as values');
  ok('a scene numbered 0 is still numbered',
     note([sc('0', '0')]) === '',
     'zero is a scene number a writer can choose');
  ok('a scene with a number but no label is numbered',
     note([sc(null, '31A')]) === '',
     'the documents fall back to scene_number, so this prints 31A not a dash');
}

console.log('\nIt says why, not just how many');
{
  const s = note([sc(null, null)]);
  ok('it says the script did not number it, not that Slate failed',
     /not numbered in the script/.test(s), s);
  // Written as one condition, because an assertion with an `|| /crew/`
  // fallback in it passes whatever the sentence says, which is worse than
  // having no assertion at all.
  ok('  ...and why Slate does not fill it in',
     /Slate does not number it, because a scene number is what a crew calls a scene by\./
       .test(s.replace(/\s+/g, ' ')),
     s + ' — a filmmaker asking "why is this blank" should find the answer '
     + 'on the document, not in support');
  ok('nothing in it invents a number',
     !/[0-9]+[A-Z]?\b(?! scenes)/.test(s.replace(/^One scene/, '')),
     s);
}

console.log('\nNothing it is handed makes it throw');
{
  [undefined, null, [], [null], [undefined], [{}], ['x'], [{ scene_label: 5 }]
  ].forEach(function (input, i) {
    let threw = '';
    try { note(input); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' is survivable', !threw, threw);
  });
}

console.log('\nIt reaches every document that prints a dash');
{
  ok('one derivation, not four counts',
     (APP.match(/function slateUnnumberedNote/g) || []).length === 1);
  ok('the breakdown screen says it',   /slateUnnumScreen/.test(APP));
  ok('the breakdown PDF says it',      /slateUnnumPdf/.test(APP));
  ok('the schedule says it',           /slateUnnumSch/.test(APP));
  ok('the call sheet says it',         /slateUnnumCs/.test(APP));
  ok('  ...counted on today’s scenes, not the film’s',
     /var slateUnnumCs = slateUnnumberedNote\(scenes\);/.test(APP),
     '"15 scenes are not numbered" on a one-day document would be read as '
     + 'fifteen of them today');
  ok('the screen version is escaped',
     /slateEscapeHtml\(slateUnnumScreen\)/.test(APP),
     'it is derived from script text');
  ok('it is said once per document, not beside every dash',
     (APP.match(/slateUnnumberedNote\(/g) || []).length === 5,
     (APP.match(/slateUnnumberedNote\(/g) || []).length
     + ' call sites (expected 5: the definition and four documents)');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
