// mergeBreakdownChunks, actually run.
//
// prompt-probe proves the derivation is WIRED UP. This proves it WORKS: it
// pulls the real merge out of app.html with its helpers, feeds it sections
// shaped like the model's output, and reads what comes out the other end.
//
// It exists because on 14 November we stopped asking the model for Reports
// 2 and 3 and for the nine all_* roll-ups, and started collecting all of
// them from the scenes. If that collection is wrong, nothing throws and no
// assertion about source code fails — a buyer just gets a shopping list
// with items missing from it, and nobody finds out until someone arrives
// on set without a prop.
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

// The real thing, with the helpers it leans on. Extracted by name, so a
// rename breaks this loudly rather than letting it test a stale copy.
const SRC = [
  line("var SLATE_NO_LOCATION_KEY ="),
  block('function slateCleanSceneNumber'),
  block('function slateKey'),
  block('function slateElementKey'),
  block('function slateMergeElements'),
  block('function slateIsPlaceholderLocation'),
  block('function slateCleanField'),
  block('function slateLocationKey'),
  block('function slateBetterLabel'),
  block('function slateTitleCase'),
  block('function mergeBreakdownChunks')
].join('\n');

const win = {};
const merge = new Function('window', 'console', SRC + '; return mergeBreakdownChunks;')(
  win, { warn() {}, error() {}, log() {} });

// A section shaped the way the model returns one — scenes carrying their
// own elements, and NOTHING else. No character_breakdown, no
// outline_schedule, no all_* lists: that is the point of the change.
function scene(n, loc, cast, extra) {
  return Object.assign({
    scene_number: String(n), int_ext: 'INT', time_of_day: 'DAY',
    location: loc, set: loc, description: 'Something happens in the room.',
    cast: cast, props: [], costume: [], equipment: [],
    stunts: [], vehicles: [], animals: [],
    special_effects: [], makeup_hair: []
  }, extra || {});
}

// ══════════════════════════════════════════════════
console.log('\nThe roll-ups are collected from the scenes');
{
  const out = merge([
    { title: 'OWO TI MO', language_detected: 'Yoruba', scenes: [
      scene(1, 'Market', ['ADA'], { props: ['Basket of yams', 'Wrapper'], vehicles: ['Danfo bus'] }),
      scene(2, 'Market', ['ADA', 'TADE'], { props: ['Wrapper'], costume: ['Agbada'] })
    ]},
    { scenes: [
      scene(3, 'Church', ['TADE'], { props: ['Candle'], makeup_hair: ['Scar prosthetic'] }),
      scene(4, 'Church', ['ADA'], { animals: ['Goat'], stunts: ['Fall down steps'] })
    ]}
  ]);
  const pe = out.production_elements;

  ok('every prop across every scene appears',
     ['Basket of yams', 'Wrapper', 'Candle'].every(p => pe.all_props.includes(p)),
     JSON.stringify(pe.all_props));
  ok('  ...and a prop on two scenes is listed once',
     pe.all_props.filter(p => /wrapper/i.test(p)).length === 1,
     JSON.stringify(pe.all_props));
  ok('costume is collected', pe.all_costume.includes('Agbada'), JSON.stringify(pe.all_costume));
  ok('vehicles are collected', pe.all_vehicles.includes('Danfo bus'), JSON.stringify(pe.all_vehicles));
  ok('animals are collected', pe.all_animals.includes('Goat'), JSON.stringify(pe.all_animals));
  ok('stunts are collected', pe.all_stunts.includes('Fall down steps'), JSON.stringify(pe.all_stunts));
  ok('makeup and hair are collected',
     pe.all_makeup_hair.includes('Scar prosthetic'), JSON.stringify(pe.all_makeup_hair));
  ok('an empty category stays an empty list, not undefined',
     Array.isArray(pe.all_special_effects) && pe.all_special_effects.length === 0,
     JSON.stringify(pe.all_special_effects));
  ok('elements are collected ACROSS sections, not just the first',
     pe.all_props.includes('Basket of yams') && pe.all_props.includes('Candle'),
     'section 2 contributed nothing if this fails');
}

// ══════════════════════════════════════════════════
console.log('\nThe cast list and Report 2 are the same people');
{
  // The old code built these from two separate answers by the model, and
  // nothing made them agree. Now one is made from the other.
  const out = merge([
    { scenes: [
      scene(1, 'Market', ['ADA', 'tade']),
      scene(2, 'Market', ['Ada']),
      scene(3, 'Church', ['TADE'])
    ]}
  ]);
  const names = out.production_elements.all_cast;
  const report2 = out.character_breakdown.map(c => c.character);

  ok('all_cast is exactly Report 2', JSON.stringify(names) === JSON.stringify(report2),
     JSON.stringify(names) + ' vs ' + JSON.stringify(report2));
  ok('  ...two people, not four, despite the spellings', names.length === 2,
     JSON.stringify(names));
  ok('Report 2 counts scenes from the scenes themselves',
     out.character_breakdown.find(c => /ada/i.test(c.character)).total === 2,
     JSON.stringify(out.character_breakdown));
  ok('  ...and the one in most scenes is cast number 1',
     out.character_breakdown[0].cast_number === 1 &&
     /ada/i.test(out.character_breakdown[0].character),
     JSON.stringify(out.character_breakdown.map(c => [c.cast_number, c.character, c.total])));
}

// ══════════════════════════════════════════════════
console.log('\nReport 3 is grouped from the scenes');
{
  const out = merge([
    { scenes: [
      scene(1, 'Market', ['ADA']),
      scene(2, 'MARKET', ['ADA']),
      scene(3, 'Church', ['TADE']),
      scene(4, '', ['TADE'])
    ]}
  ]);
  const locs = out.outline_schedule;
  const market = locs.find(l => /market/i.test(l.set_location));
  ok('one market, not two, despite the shouting', market && market.total === 2,
     JSON.stringify(locs.map(l => [l.set_location, l.total])));
  ok('a scene with no location still appears', locs.some(l => l.no_location),
     'seventeen scenes once vanished from a 47-scene report');
  ok('  ...and the unplaced group sits last',
     locs[locs.length - 1].no_location === true,
     'it is a list of questions, not a place to send a crew');
}

// ══════════════════════════════════════════════════
console.log('\nspecial_requirements still comes from the model');
{
  const out = merge([
    { scenes: [scene(1, 'Market', ['ADA'])],
      production_elements: { special_requirements: ['Market trading permit'] } },
    { scenes: [scene(2, 'Church', ['TADE'])],
      production_elements: { special_requirements: ['Permission to film in church'] } }
  ]);
  const sr = out.production_elements.special_requirements;
  ok('both sections contribute', sr.length === 2, JSON.stringify(sr));
  ok('  ...and it is the one list not derived from scenes',
     sr.includes('Market trading permit') && sr.includes('Permission to film in church'),
     JSON.stringify(sr));
}

// ══════════════════════════════════════════════════
console.log('\nA section that returns nothing extra still merges');
{
  // What the model now actually sends: scenes and nothing else.
  const out = merge([{ scenes: [scene(1, 'Market', ['ADA'], { props: ['Yam'] })] }]);
  ok('no production_elements on the section -> no crash',
     out && out.production_elements && Array.isArray(out.production_elements.all_props));
  ok('  ...and the props are still collected', out.production_elements.all_props.includes('Yam'));
  ok('  ...and special_requirements is an empty list',
     Array.isArray(out.production_elements.special_requirements) &&
     out.production_elements.special_requirements.length === 0);
  ok('scene_index is assigned, which every document joins on',
     out.scenes[0].scene_index === 1, JSON.stringify(out.scenes[0].scene_index));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
