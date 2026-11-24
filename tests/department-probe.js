// What each department has to bring, and on which day.
//
//   node tests/department-probe.js
//
// WHY THIS FILE EXISTS
//
// Slate carries nine element categories per scene and rolled them up per
// PRODUCTION — Report 4, every prop in the picture — with nothing in
// between. The useful unit is the day, and nothing answered the only
// question a department head actually asks: what do I need on Tuesday.
//
// A props master reads a day, not a film. Before this they had to read
// six scene blocks on the call sheet and merge the lists in their head,
// and a props master merging lists in their head at 6am is how a prop
// gets left in the van.
//
// WHAT MATTERS HERE
//
// The scene labels beside each item, as much as the items. "Floor loom
// (1, 5)" says it is needed twice and has to survive the day; "Shuttle
// (1)" says it wraps after scene 1. A bare list of items loses the part a
// department plans around.
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
function stmt(needle) {
  const s = APP.indexOf(needle);
  return APP.slice(s, APP.indexOf('];', s) + 2);
}

const load = new Function(
  stmt('var SLATE_DEPARTMENTS = [') + '\n'
  + block('function slateDepartmentLoad') + '\n'
  + '; return slateDepartmentLoad;')();

const sc = (label, fields) => Object.assign({ scene_label: label, scene_number: label }, fields);
const dep = (out, name) => out.filter(d => d.department === name)[0];

// ══════════════════════════════════════════════════
console.log('\nItems are grouped by department, with the scenes they are needed in');
{
  const out = load([
    sc('1', { props: ['Floor loom', 'Shuttle'], costume: ['Torn school shirt'] }),
    sc('2', { props: ['Suitcase'], set_dressing: ['Market stalls'] }),
    sc('5', { props: ['Floor loom'] })
  ]);

  ok('props are collected', !!dep(out, 'Props'));
  ok('  ...with the scenes each is needed in',
     JSON.stringify(dep(out, 'Props').items.filter(i => /loom/i.test(i.item))[0].scenes)
       === '["1","5"]',
     JSON.stringify(dep(out, 'Props').items));
  ok('  ...and an item in one scene says so',
     JSON.stringify(dep(out, 'Props').items.filter(i => /Shuttle/.test(i.item))[0].scenes)
       === '["1"]',
     'a prop in one scene wraps after it; a prop in two has to survive '
     + 'between them');
  ok('set dressing is its own department, not props',
     !!dep(out, 'Set Dressing')
     && !dep(out, 'Props').items.some(i => /stalls/i.test(i.item)),
     'a sofa and a wristwatch are two budgets');
  ok('costume is collected', !!dep(out, 'Costume'));
}

console.log('\nOne item needed twice is packed once');
{
  // Case matters here and only here: "Floor loom" in scene 1 and "floor
  // loom" in scene 5 is ONE prop, and a department reading two lines
  // packs two.
  const out = load([
    sc('1', { props: ['Floor loom'] }),
    sc('5', { props: ['floor loom'] }),
    sc('9', { props: ['FLOOR LOOM'] })
  ]);
  ok('three spellings are one item', dep(out, 'Props').items.length === 1,
     JSON.stringify(dep(out, 'Props').items));
  ok('  ...listed in all three scenes',
     JSON.stringify(dep(out, 'Props').items[0].scenes) === '["1","5","9"]',
     JSON.stringify(dep(out, 'Props').items[0].scenes));
  ok('  ...keeping the spelling the script used first',
     dep(out, 'Props').items[0].item === 'Floor loom',
     'the breakdown wrote it; we are not improving it');
}

console.log('\nA department with nothing to bring does not appear');
{
  const out = load([sc('1', { props: ['Shuttle'] })]);
  ok('only the departments with items are returned',
     out.length === 1 && out[0].department === 'Props',
     JSON.stringify(out.map(d => d.department))
     + ' — most films have no animals, and a row of empty headings teaches '
     + 'a crew that the headings mean nothing');
  ok('a scene with no elements contributes nothing',
     load([sc('1', {}), sc('2', {})]).length === 0);
  ok('empty strings and the literal "null" are dropped',
     load([sc('1', { props: ['', '  ', 'null', 'undefined', 'Shuttle'] })])[0]
       .items.length === 1);
}

console.log('\nA montage split across days is not packed twice');
{
  // A montage's setups are scheduled separately, so a day lists its scene
  // once per setup. The caller collects the full scene once — asserted on
  // the renderer below — but the derivation must also be safe if handed
  // the same scene twice.
  const one = sc('4', { props: ['Aso-oke'] });
  const out = load([one, one]);
  ok('the same scene twice yields one item',
     dep(out, 'Props').items.length === 1, JSON.stringify(dep(out, 'Props').items));
  ok('  ...and names the scene once',
     JSON.stringify(dep(out, 'Props').items[0].scenes) === '["4"]',
     JSON.stringify(dep(out, 'Props').items[0].scenes));
}

console.log('\nAll twelve departments are covered');
{
  const out = load([sc('1', {
    props: ['a'], set_dressing: ['b'], costume: ['c'], makeup_hair: ['d'],
    equipment: ['e'], stunts: ['f'], vehicles: ['g'], animals: ['h'],
    special_effects: ['i'], visual_effects: ['j'], sound: ['k'], music: ['l']
  })]);
  ok('every category maps to a department', out.length === 12, out.length + ' of 12');
  // The four added on 23 November, which this feature exists to make
  // usable: before it, nobody could answer what the art department brings
  // on Tuesday.
  ['Set Dressing', 'VFX', 'Sound', 'Music'].forEach(function (name) {
    ok('  ' + name + ' is a department', !!dep(out, name));
  });
  ok('departments print in a fixed order, props first',
     out[0].department === 'Props',
     'a sheet whose rows move between days cannot be scanned');
}

console.log('\nNothing it is handed makes it throw');
{
  [undefined, null, [], [null], [undefined], [{}], [sc('1', { props: 'a string' })]
  ].forEach(function (input, i) {
    let threw = '';
    try { load(input); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' is survivable', !threw, threw);
  });
  ok('a bare string element is accepted as one item',
     load([sc('1', { props: 'Shuttle' })])[0].items[0].item === 'Shuttle',
     'the model returns a string for some scenes and an array for others');
  ok('a scene with no label is named with a dash',
     load([{ props: ['x'] }])[0].items[0].scenes[0] === '—');
}

// ══════════════════════════════════════════════════
console.log('\nOne derivation, two documents');
{
  ok('the call sheet renders today’s load',
     /pdf\.sectionHeader\('Department Load \\u2014 Today'\)/.test(APP));
  ok('the schedule renders every day’s',
     /pdf\.sectionHeader\('Department Load by Day'\)/.test(APP));
  ok('both read the same function',
     (APP.match(/slateDepartmentLoad\(/g) || []).length === 3,
     (APP.match(/slateDepartmentLoad\(/g) || []).length
     + ' call sites (expected 3: the definition and two renderers)');

  // The schedule works from the BREAKDOWN's scenes, because the schedule
  // carries slim scenes without elements.
  ok('the schedule joins the day back to the breakdown by scene_index',
     /byIndex\[Number\(row\.scene_index\)\]/.test(APP));
  ok('  ...collecting a split montage once',
     /if \(!full \|\| seen\[row\.scene_index\]\) return;/.test(APP),
     'a day lists a montage once per setup, and a department does not pack '
     + 'the same prop twice for one scene');
  ok('  ...and prints nothing when the breakdown is not loaded',
     /if \(!bdScenes\.length\) return;/.test(APP),
     'an empty section reads as a fault rather than an absence');
}

console.log('\nThe day label does not print through its own rows');
{
  // sceneNumeral draws at y+4 and never advances y — it is built to sit
  // beside a slugline, and in a scene row it is body() that moves the
  // cursor past it. Without a gap the first two department rows printed
  // straight through "Day 01". Found by rendering the schedule and
  // looking at it, which is the fourth time today.
  const sched = APP.slice(APP.indexOf("pdf.sectionHeader('Department Load by Day')"),
                          APP.indexOf("siqTrack('pdf_export', { document_type: 'schedule'"));
  ok('the numeral is cleared before the rows',
     /pdf\.sceneNumeral\('Day '[\s\S]{0,400}?pdf\.gap\(7\);[\s\S]{0,200}?load\.forEach/.test(sched),
     'sceneNumeral does not advance y');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
