// Background on a shoot day: once per scene, not once per setup.
//
//   node tests/background-probe.js
//
// WHY THIS FILE EXISTS
//
// A montage became several scheduling UNITS — one per setup — so it can be
// shot at the several places it visits. Every one of those units carries
// its scene's background, and the day's BG line listed them per unit. THE
// WEAVER'S DAUGHTER, one montage on the day, printed:
//
//   BG: 4 (Neighbours...) · 4 (Neighbours...) · 2 (Market traders...)
//       · 4 (Neighbours...) · 4 (Neighbours...)
//
// Background is booked per scene. A casting call for four neighbours is
// one call however many setups the montage needs, and a line that says it
// four times reads as four calls.
//
// This is the same miss as the call sheet counting a split montage's scene
// twice. That one was fixed where it was found and not looked for
// anywhere else — and the unit was the thing that was new, so every place
// that counts scenes should have been re-read when it arrived.
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
const bg = new Function(block('function slateDayBackgrounds')
  + '; return slateDayBackgrounds;')();

// A montage scheduled as four setups is four units carrying one scene.
const setup = (beat) => ({ scene_index: 5, scene_number: '4', beat: beat,
                           background: 'Neighbours watching from their doorways' });

console.log('\nA montage is one background call, not one per setup');
{
  const day = [
    { scene_index: 3, scene_number: '3', background: 'Receptionist' },
    setup(1), setup(2), setup(3), setup(4),
    { scene_index: 2, scene_number: '2', background: 'Market traders, a driver' }
  ];
  const out = bg(day);
  ok('each scene appears once', out.length === 3, JSON.stringify(out));
  ok('  ...the montage among them',
     out.filter(b => b.scene === '4').length === 1,
     JSON.stringify(out.map(b => b.scene)));
  ok('  ...in the order the day shoots them',
     out.map(b => b.scene).join(',') === '3,4,2',
     out.map(b => b.scene).join(','));
  ok('the first setup’s text is the one kept',
     out[1].text === 'Neighbours watching from their doorways', JSON.stringify(out[1]));
}

console.log('\nOne scene whose units spell it differently is still one call');
{
  // The case that separates keying on the SCENE from keying on scene plus
  // text. Two units of one montage, the text differing by a capital, is
  // one casting call — a key built from the text books it twice.
  const out = bg([
    { scene_index: 5, scene_number: '4', background: 'Neighbours' },
    { scene_index: 5, scene_number: '4', background: 'neighbours' }
  ]);
  ok('one entry, not two', out.length === 1, JSON.stringify(out));
}

console.log('\nTwo different scenes with the same background are both booked');
{
  // The opposite mistake: collapsing by TEXT would hide that two separate
  // scenes each need neighbours, which is two calls on two different days
  // if they ever split.
  const out = bg([
    { scene_index: 1, scene_number: '1', background: 'Neighbours' },
    { scene_index: 7, scene_number: '7', background: 'Neighbours' }
  ]);
  ok('both are listed', out.length === 2, JSON.stringify(out));
}

console.log('\nIt normalises the way the other two BG renderers already do');
{
  ok('an array is joined',
     bg([{ scene_index: 1, scene_number: '1', background: ['Traders', 'A driver'] }])[0].text
       === 'Traders, A driver');
  ok('  ...with empty entries dropped',
     bg([{ scene_index: 1, scene_number: '1', background: ['Traders', '', null] }])[0].text
       === 'Traders');
  ok('the strings "null" and "undefined" are not background',
     bg([{ scene_index: 1, scene_number: '1', background: 'null' },
         { scene_index: 2, scene_number: '2', background: 'undefined' }]).length === 0,
     'they reach this field as text, which is why the other two renderers '
     + 'already guard for them');
  ok('whitespace alone is not background',
     bg([{ scene_index: 1, scene_number: '1', background: '   ' }]).length === 0);
  ok('a scene with no background contributes nothing',
     bg([{ scene_index: 1, scene_number: '1' }]).length === 0);
}

console.log('\nA unit with no scene_index falls back to the number');
{
  // Slim schedule rows do not all carry scene_index.
  const out = bg([{ scene_number: '4', background: 'Neighbours' },
                  { scene_number: '4', background: 'Neighbours' }]);
  ok('still one entry', out.length === 1, JSON.stringify(out));
}

console.log('\nNothing it is handed makes it throw');
{
  [undefined, null, [], [null], [undefined], [{}], ['x'], [{ background: 5 }]
  ].forEach(function (input, i) {
    let threw = '';
    try { bg(input); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' is survivable', !threw, threw);
  });
}

// ══════════════════════════════════════════════════
console.log('\nIt is what the day actually renders');
{
  ok('the schedule day reads the helper',
     /var bgScenes = slateDayBackgrounds\(d\.scenes\);/.test(APP));
  ok('  ...and no hand-rolled dedup is left beside it',
     !/var seenBg = \{\};/.test(APP),
     'two sessions fixed this an hour apart; one derivation survives');
  ok('the text is escaped',
     /slateEscapeHtml\(b\.text\)/.test(APP) && /slateEscapeHtml\(String\(b\.scene\)\)/.test(APP),
     'it is script text, and a background line is one of the few places it '
     + 'reaches the page unquoted');
  ok('one derivation, one reader',
     (APP.match(/slateDayBackgrounds\(/g) || []).length === 2,
     (APP.match(/slateDayBackgrounds\(/g) || []).length
     + ' (expected 2: the definition and the day)');
}

console.log('\nOne day is not "1 days"');
{
  ok('the count is singular when there is one',
     /days\.length \+ \(days\.length === 1 \? ' day' : ' days'\)/.test(APP),
     'a six-scene short schedules to one day, which is the first thing a '
     + 'filmmaker trying Slate sees');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
