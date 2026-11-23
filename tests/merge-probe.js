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
// A whole `var NAME = ...;` declaration, however many lines it spans.
function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
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
  // Added 16 Nov when the merge started keying cast through its own
  // function. The harness threw rather than silently testing a stale copy,
  // which is the whole reason these extract by name.
  block('function slateCastKey'),
  block('function slateElementKey'),
  block('function slateMergeElements'),
  block('function slateIsPlaceholderLocation'),
  block('function slateCleanField'),
  // Needed by slateLocationKey, and missing here until 19 November: every
  // location in this file was a single word, so the branch that trims
  // trailing structural words ("MAMA BOLA HOUSE" -> "mamabola") was never
  // once executed by this harness. It threw the moment a two-word location
  // appeared.
  stmt('var SLATE_LOC_STRUCTURAL'),
  block('function slateLocationKey'),
  block('function slateBetterLabel'),
  block('function slateTitleCase'),
  // What a scene shows when it carries no number of the script's own, and
  // the two helpers that decide it. Extracted, not restated: a breakdown
  // whose labels disagree with its own footnote is the bug this prevents.
  stmt('var SLATE_NO_NUMBER'),
  // The sequence vocabulary, needed by the merge's check that the page
  // agrees before a MONTAGE tag survives.
  stmt('var SLATE_SEQUENCE'),
  // Needed by the missing-scene check: a (CONT'D) heading is a page
  // break, not a scene, and warning about one would teach filmmakers to
  // ignore the warning.
  stmt('var SLATE_CONTD_RE'),
  block('function slateSceneNumberOrNull'),
  block('function slateScriptIsNumbered'),
  // The heading matcher the merge now uses when the counts disagree.
  stmt('var SLATE_MATCH_SKIP'),
  block('function slateSceneMatchTokens'),
  block('function slateSceneMatchScore'),
  block('function slateAlignModelScenes'),
  block('function mergeBreakdownChunks'),
  // The note that tells a filmmaker a scene is absent. Extracted rather
  // than restated: a warning whose wording drifts from the code is a
  // warning nobody can check.
  block('function slateRestoredNote'),
  // A slug line broken into its parts, so a scene the model never returned
  // can still be put on the document from the page alone.
  stmt('var SLATE_HEAD ='),
  stmt('var SLATE_NUM  ='),
  block('function slateParseHeading'),
  // The continuity key, normalised at the boundary. The merge is where the
  // model's answer arrives, so it is the one place that reads it — which is
  // why this probe needs it and the two serverless functions do not.
  block('function slateStoryDay')
].join('\n');

const win = {};
const api = new Function('window', 'console', SRC
  + '; return { merge: mergeBreakdownChunks, restoredNote: slateRestoredNote };')(
  win, { warn() {}, error() {}, log() {} });
const merge = api.merge;
const slateRestoredNote = api.restoredNote;

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

  // ── The four categories added 23 November ──
  //
  // Set dressing, visual effects, sound and music did not exist anywhere
  // in the product. The roll-ups are listed by name in the merge rather
  // than looped, precisely so that a category added to the scene schema
  // and NOT added there fails here instead of silently vanishing from
  // every document.
  const four = merge([{ title: 'THE WEAVER’S DAUGHTER', scenes: [
    scene(1, 'Workshop', ['ADUKE'], {
      set_dressing: ['Floor loom', 'Folded aso-oke'],
      sound: ['Playback for the weaving rhythm'] }),
    scene(2, 'Lagos Office', ['TOLANI'], {
      set_dressing: ['Folded aso-oke'],
      visual_effects: ['Composited view through the window'],
      music: ['Ko Si Baba Bi Baba'] })
  ]}]).production_elements;

  ok('set dressing is collected',
     four.all_set_dressing.includes('Floor loom'), JSON.stringify(four.all_set_dressing));
  ok('  ...and dressing used on two scenes is listed once',
     four.all_set_dressing.filter(v => /aso-oke/i.test(v)).length === 1,
     JSON.stringify(four.all_set_dressing));
  ok('visual effects are collected',
     four.all_visual_effects.includes('Composited view through the window'),
     JSON.stringify(four.all_visual_effects));
  ok('sound is collected',
     four.all_sound.includes('Playback for the weaving rhythm'),
     JSON.stringify(four.all_sound));
  ok('music is collected',
     four.all_music.includes('Ko Si Baba Bi Baba'), JSON.stringify(four.all_music));
  ok('  ...and a song title is not translated into English',
     four.all_music.join(' ') === 'Ko Si Baba Bi Baba',
     JSON.stringify(four.all_music)
     + ' — clearance is bought against a title, so a translated title names '
     + 'a different song');

  // Set dressing must NOT be folded into props. A sofa and a wristwatch
  // are two departments with two budgets, and until tonight the art
  // department was handed them in one column.
  ok('set dressing stays out of props',
     !four.all_props.some(v => /loom|aso-oke/i.test(v)),
     JSON.stringify(four.all_props));
}

// ══════════════════════════════════════════════════
// EVERY PRODUCTION SAVED BEFORE TONIGHT.
console.log('\nA breakdown with none of the four fields still merges');
{
  // The four fields did not exist until 23 November, so every saved
  // production and every in-flight run has scenes without them. The merge
  // must produce empty lists rather than undefined, because the renderers
  // call .length on them.
  const bare = { scene_number: '1', int_ext: 'INT', time_of_day: 'DAY',
                 location: 'Workshop', set: 'Workshop', description: 'She weaves.',
                 cast: ['ADUKE'], props: ['Loom'] };
  let out = null, threw = '';
  try { out = merge([{ title: 'Old Production', scenes: [bare] }]); }
  catch (e) { threw = e.message; }

  ok('it does not throw', !threw, threw);
  ok('  ...and the scene survives', out && (out.scenes || []).length === 1);

  const pe = (out && out.production_elements) || {};
  ['all_set_dressing', 'all_visual_effects', 'all_sound', 'all_music'].forEach(function (k) {
    ok('  ' + k + ' is an empty array, not undefined',
       Array.isArray(pe[k]) && pe[k].length === 0,
       JSON.stringify(pe[k]) + ' — every renderer calls .length on this');
  });
  ok('  ...and the five older categories are unaffected',
     Array.isArray(pe.all_stunts) && Array.isArray(pe.all_makeup_hair));
}

// ══════════════════════════════════════════════════
// THE ONE RISK THAT CANNOT BE MEASURED WITHOUT THE MODEL.
console.log('\nThe run reports how often the model filled each category');
{
  // The A/B harness compares two READINGS of a script. It says nothing
  // about how the model answers a changed prompt, and a changed prompt is
  // what caused both of 23 November's regressions. So the run counts its
  // own answers, and the first real run after this ships is the
  // measurement.
  //
  // Two opposite failures, and these numbers tell them apart: a count near
  // the scene total means the model is padding — a sofa invented for every
  // room — and zero on a script that plainly has dressing means it is not
  // reading the category at all.
  const out = merge([{ title: 'Instrumented', scenes: [
    scene(1, 'Workshop', ['ADUKE'], { set_dressing: ['Floor loom'], props: ['Shuttle'] }),
    scene(2, 'Market', ['TOLANI'], { set_dressing: ['Stalls'], music: ['Market radio'] }),
    scene(3, 'Office', ['TOLANI'], {})
  ]}]);
  const r = out.production_elements.slate_reading;

  ok('the four new categories are counted',
     r.scenes_with_set_dressing === 2 && r.scenes_with_music === 1
     && r.scenes_with_visual_effects === 0 && r.scenes_with_sound === 0,
     JSON.stringify({ sd: r.scenes_with_set_dressing, vfx: r.scenes_with_visual_effects,
                      snd: r.scenes_with_sound, mus: r.scenes_with_music }));
  ok('  ...and the older ones too, so the new have something to be judged against',
     r.scenes_with_props === 1 && r.scenes_with_stunts === 0,
     JSON.stringify({ props: r.scenes_with_props, stunts: r.scenes_with_stunts })
     + ' — "dressing on 40 scenes" means one thing beside "props on 44" and '
     + 'another beside "props on 6"');
  ok('  ...against the scene total',
     r.scenes_total === 3, r.scenes_total + '');

  // Scenes, not items. A scene listing nine dressing entries and a scene
  // listing one are both one scene the model actually read.
  const many = merge([{ scenes: [
    scene(1, 'Workshop', ['ADUKE'], { set_dressing: ['a', 'b', 'c', 'd', 'e'] })
  ]}]).production_elements.slate_reading;
  ok('a scene with five entries counts once',
     many.scenes_with_set_dressing === 1, many.scenes_with_set_dressing + '');
  ok('  ...and an empty list counts as not read',
     merge([{ scenes: [scene(1, 'Workshop', ['ADUKE'], { set_dressing: [] })] }])
       .production_elements.slate_reading.scenes_with_set_dressing === 0);

  // Counts only. This is the promise the instrumentation was added under:
  // no line of anyone's screenplay leaves the browser.
  Object.keys(r).forEach(function (k) {
    ok('  ' + k + ' is a number or a boolean, never text',
       typeof r[k] === 'number' || typeof r[k] === 'boolean',
       JSON.stringify(r[k]) + ' — we keep no screenplays and this must not '
       + 'become the exception');
  });
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

// ══════════════════════════════════════════════════
// Through the REAL merge, because labelFor's answer depends on a count
// taken across every chunk, and a per-chunk count would be wrong in
// exactly the way that is hard to see: each section would judge the kind
// of script for itself, and a section that happened to hold the
// unnumbered stretch would print dashes while the rest printed numbers.
console.log('\nWhat a scene is called, on a script that numbers its own');
{
  // The numbers come from what we read off the PAGE, never from the model,
  // so they are supplied the way the splitter supplies them. Six numbered
  // headings and two we could not read a number for, in each of two
  // sections \u2014 twelve and four across the script.
  const heads = n => Array.from({ length: 8 }, (ignored, k) =>
    'INT. MARKET ' + (n * 8 + k) + ' - DAY');
  win.slateChunkNumbers = [
    ['1', '2', '3', '4', '5', '6', null, null],
    ['7', '8', '9', '10', '11', '12', null, null]
  ];
  win.slateChunkHeads = [heads(0), heads(1)];

  const section = n => ({
    scenes: Array.from({ length: 8 }, (ignored, k) =>
      scene(n * 8 + k + 1, 'Market ' + (n * 8 + k), ['ADA']))
  });
  const out = merge([section(0), section(1)]);
  const labels = out.scenes.map(s => s.scene_label);
  win.slateChunkNumbers = null; win.slateChunkHeads = null;

  ok('the writer\u2019s own numbers print untouched',
     labels.filter(l => /^\d+$/.test(l)).length === 12, JSON.stringify(labels));
  ok('EVERY unplaced scene shows a dash \u2014 none of them a number of ours',
     labels.filter(l => l === '\u2014').length === 4
     && !labels.some(l => String(l).charAt(0) === '#'),
     JSON.stringify(labels) + '  <- a "#" here is the producer\u2019s complaint');
  ok('  ...including the ones in the SECOND section',
     labels.slice(8).filter(l => l === '\u2014').length === 2,
     JSON.stringify(labels.slice(8))
     + '  <- a per-chunk count would judge each section on its own');
  ok('  ...and the model\u2019s own numbers never override the page',
     labels[0] === '1' && labels[8] === '7',
     JSON.stringify(labels.slice(0, 9)));
}

// ══════════════════════════════════════════════════
// THE SECTION BOUNDARY.
//
// We send the model at most four scenes per request, so a feature is
// twenty-odd separate calls. Those sections are an artefact of how we
// call the model and nothing to do with the script — but the matching
// used to run INSIDE one, against four headings at a time.
//
// A scene whose true heading sits in the section next door is then
// unmatchable however good the matcher is. On THE HILLS BETWEEN US that
// cost 29 of the writer's numbers: 42 recovered section by section
// against 71 across the whole script, same matcher, same data, same day.
//
// Every assertion we had tested the matcher. None tested the window it
// ran in, so all 764 stayed green while a filmmaker got 42.
console.log('\nMatching reaches across section boundaries');
{
  // Sixteen headings, numbered 1-16, in four sections of four.
  const heads = [], nums = [];
  for (let k = 1; k <= 16; k++) {
    heads.push('INT. LOCATION ' + k + ' - DAY');
    nums.push(String(k));
  }
  const chunk4 = list => [list.slice(0, 4), list.slice(4, 8),
                          list.slice(8, 12), list.slice(12, 16)];
  win.slateChunkHeads = chunk4(heads);
  win.slateChunkNumbers = chunk4(nums);

  // The model read the opening as three scenes rather than four. Every
  // section after it is therefore offset by one against our headings: its
  // second response covers our headings 4-7, not 5-8, and so on. This is
  // the ordinary case, not a pathological one.
  const all = [];
  for (let k = 1; k <= 16; k++) {
    all.push(scene(k, 'Location ' + k, ['ADA']));
  }
  const out = merge([
    { scenes: all.slice(0, 3) }, { scenes: all.slice(3, 7) },
    { scenes: all.slice(7, 11) }, { scenes: all.slice(11, 16) }
  ]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;

  const labels = out.scenes.map(s => s.scene_label);
  ok('EVERY scene finds its own number, across all four sections',
     JSON.stringify(labels) === JSON.stringify(nums),
     JSON.stringify(labels)
     + '  <- matched section by section, the later ones come back as dashes');
  ok('  ...and the last section in particular',
     JSON.stringify(labels.slice(12)) === '["13","14","15","16"]',
     JSON.stringify(labels.slice(12)));
}

// ══════════════════════════════════════════════════
// HOW THE READING WENT, IN NUMBERS.
//
// On 22 November a producer's breakdown came back with 117 scenes for a
// script whose numbers run to 71, and the two possible causes need
// opposite fixes: either WE found 117 headings on his pages, or the MODEL
// returned 37 scenes his script does not have. Nothing stored could tell
// them apart, and we keep no screenplays, so there was no way to find
// out — and asking a filmmaker for their script is the one thing we
// promise never to do.
console.log('\nThe reading records its own counts');
{
  win.slateChunkHeads = [['INT. KITCHEN - DAY', 'EXT. MARKET - DAY', 'INT. CHURCH - NIGHT']];
  win.slateChunkNumbers = [['1', '2', null]];
  // Four scenes against three headings: the model split one.
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']), scene(2, 'Market', ['ADA']),
    scene(3, 'Market', ['ADA']), scene(4, 'Church', ['TADE'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  const d = (out.production_elements || {}).slate_reading;

  ok('the counts are recorded', !!d, JSON.stringify(out.production_elements || {}).slice(0, 120));
  ok('  ...our headings', d && d.headings_read === 3, d && d.headings_read);
  ok('  ...the numbers we read off them', d && d.numbers_read === 2, d && d.numbers_read);
  ok('  ...what the model returned', d && d.model_scenes === 4, d && d.model_scenes);
  ok('  ...and how many we could place', d && d.scenes_placed === 3, d && d.scenes_placed);
  ok('  ...and that the counts did NOT agree',
     d && d.every_section_agreed === false, d && d.every_section_agreed);

  // The whole point: these two numbers, side by side, say whose
  // inflation it is. Equal means we read every scene the model returned.
  ok('headings_read vs model_scenes is what answers the question',
     d && d.model_scenes > d.headings_read,
     'the model returned more than the script has — that is a prompt fault, not a reader fault');

  // Counts only. A screenplay must not be reconstructable from this.
  const text = JSON.stringify(d);
  ok('NO screenplay content is recorded',
     !/Kitchen|Market|Church|ADA|TADE|INT\.|EXT\./i.test(text), text);
  ok('  ...and every value is a number or a boolean',
     Object.values(d).every(v => typeof v === 'number' || typeof v === 'boolean'), text);
}

// ══════════════════════════════════════════════════
// A MONTAGE'S BEATS REACH THE BREAKDOWN.
//
// The model is told a montage is ONE scene, so it does not return the
// beats — and it never needed to. "— INT. LAGOS ART GALLERY — EVENING"
// is parsed exactly by slateMontageBeat, off the page, so the beats are
// right whatever the model does and cost nothing to obtain.
//
// They have to arrive, though. A montage that reads as one row with its
// ten setups nowhere on the document is worse than the inflated count it
// replaced: an AD scheduling from it loses a day.
console.log('\nThe setups inside a montage reach the scene');
{
  win.slateChunkHeads = [['INT. ADEYEMI HOUSE - MORNING',
                          'MONTAGE - VARIOUS LOCATIONS - MONTHS PASSING',
                          'EXT. IMOLE LAKE - SUNSET']];
  win.slateChunkNumbers = [['1', '2', '3']];
  win.slateChunkBeats = [[null,
                          ['INT. ABEGUNDE HOUSE — DAY',
                           'INT. LAGOS ART GALLERY — EVENING',
                           'EXT. VILLAGE SQUARE — DAY'],
                          null]];
  const out = merge([{ scenes: [
    scene(1, 'Adeyemi House', ['OMOWON']),
    scene(2, 'Various Locations', ['OMOWON']),
    scene(3, 'Imole Lake', ['AKIN'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null; win.slateChunkBeats = null;

  const mont = out.scenes[1];
  ok('three scenes come out', out.scenes.length === 3, out.scenes.length + '');
  ok('the montage carries its three setups',
     (mont.montage_beats || []).length === 3, JSON.stringify(mont.montage_beats));
  ok('  ...with their own locations intact',
     (mont.montage_beats || []).join(' | ').indexOf('LAGOS ART GALLERY') >= 0,
     JSON.stringify(mont.montage_beats));
  ok('  ...and it keeps the writer\u2019s number', mont.scene_label === '2',
     mont.scene_label);
  ok('the scenes either side carry no beats',
     !out.scenes[0].montage_beats && !out.scenes[2].montage_beats,
     JSON.stringify([out.scenes[0].montage_beats, out.scenes[2].montage_beats]));
}

// ══════════════════════════════════════════════════
// THE PAGE'S WORD ON WHETHER A SCENE IS A MONTAGE.
//
// Scene 5 of THE WEAVER'S DAUGHTER came back typed MONTAGE. It is "INT.
// ADUKE'S WORKSHOP — NIGHT", an ordinary two-hander sitting directly
// after a montage, and the tag had run on in the model's own answer. An
// AD reading MONTAGE on that scene is told something false about how it
// shoots.
console.log('\nA montage tag the page does not support is dropped');
{
  win.slateChunkHeads = [['MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING',
                          "INT. ADUKE'S WORKSHOP - NIGHT"]];
  win.slateChunkNumbers = [['4', '5']];
  const out = merge([{ scenes: [
    Object.assign(scene(4, 'Various Locations', ['ADUKE']), { scene_type: 'MONTAGE' }),
    Object.assign(scene(5, "Aduke's Workshop", ['ADUKE']), { scene_type: 'MONTAGE' })
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;

  ok('the real montage keeps its tag', out.scenes[0].scene_type === 'MONTAGE',
     String(out.scenes[0].scene_type));
  ok('the ordinary scene after it loses the one that ran on',
     !out.scenes[1].scene_type, String(out.scenes[1].scene_type)
     + '  <- the heading says INT. ADUKE\u2019S WORKSHOP, not MONTAGE');
}

// ══════════════════════════════════════════════════
// A MONTAGE DOES NOT RUN ON THROUGH THE FILM.
//
// A scene_type opens a SPAN that runs forward until the next type or a
// marked return, and with no return in the script, to the end. Right for
// a FLASHBACK, which really does run across scenes. Wrong for a MONTAGE,
// which is one scene by definition.
//
// Measured on real runs before this was fixed:
//
//   THE HILLS BETWEEN US   96 of 110 scenes tagged, 104 shown as another time
//   iRANTI                 37 of 117 tagged,        111 shown as another time
//   a producer's script     8 of 117 tagged,         82 shown as another time
//
// An AD reading that is told two thirds of the film needs flashback
// continuity — different costume, hair and makeup — when it does not.
console.log('\nA montage does not tag every scene after it');
{
  const heads = ['INT. KITCHEN - DAY', 'MONTAGE - VARIOUS LOCATIONS - A YEAR',
                 'EXT. MARKET - DAY', 'INT. CHURCH - NIGHT', 'EXT. RIVER - DAWN',
                 'INT. CLINIC - DAY'];
  win.slateChunkHeads = [heads];
  win.slateChunkNumbers = [['1', '2', '3', '4', '5', '6']];
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']),
    Object.assign(scene(2, 'Various Locations', ['ADA']), { scene_type: 'MONTAGE' }),
    scene(3, 'Market', ['ADA']), scene(4, 'Church', ['TADE']),
    scene(5, 'River', ['ADA']), scene(6, 'Clinic', ['TADE'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;

  const types = out.scenes.map(s => s.scene_type || '-');
  const frames = out.scenes.map(s => s.slate_time_frame || '-');

  ok('only the montage is tagged a montage',
     JSON.stringify(types) === '["-","MONTAGE","-","-","-","-"]',
     JSON.stringify(types) + '  <- a tag running on marks the rest of the film');
  ok('  ...and only the montage is shown as another time',
     frames.filter(f => f === 'other').length <= 1,
     JSON.stringify(frames));
  ok('the four scenes AFTER it are ordinary',
     out.scenes.slice(2).every(s => !s.scene_type && s.slate_time_frame !== 'other'),
     JSON.stringify(out.scenes.slice(2).map(s => [s.scene_type, s.slate_time_frame])));
  ok('and none of them picked up a continuity note',
     out.scenes.slice(2).every(s => !s.scene_continuity),
     'a scene told it is inside a montage shoots differently');
}

console.log('\nA FLASHBACK still spans, because it really does');
{
  const heads = ['INT. KITCHEN - DAY', 'EXT. COMPOUND - DAY', 'INT. SCHOOL - DAY',
                 'INT. KITCHEN - NIGHT'];
  win.slateChunkHeads = [heads];
  win.slateChunkNumbers = [['1', '2', '3', '4']];
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']),
    Object.assign(scene(2, 'Compound', ['ADA']), { scene_type: 'FLASHBACK' }),
    scene(3, 'School', ['ADA']),
    scene(4, 'Kitchen', ['ADA'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  const types = out.scenes.map(s => s.scene_type || '-');
  ok('the flashback carries on to the scenes inside it',
     types[1] === 'FLASHBACK' && types[2] === 'FLASHBACK',
     JSON.stringify(types) + '  <- a flashback genuinely runs across scenes');
}

console.log('\nBut a type the page cannot speak to is left alone');
{
  // A writer need not mark a flashback, and the model reads it from the
  // content. Only SEQUENCE types are checked against the heading, because
  // a montage IS a heading form.
  win.slateChunkHeads = [["INT. ADUKE'S WORKSHOP - DAY"]];
  win.slateChunkNumbers = [['7']];
  const out = merge([{ scenes: [
    Object.assign(scene(7, "Aduke's Workshop", ['ADUKE']), { scene_type: 'FLASHBACK' })
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  ok('FLASHBACK survives an unmarked heading',
     out.scenes[0].scene_type === 'FLASHBACK', String(out.scenes[0].scene_type));
}

console.log('\nAnd on a script that numbers nothing at all');
{
  const out = merge([{ scenes: [
    scene(1, 'Market', ['ADA']), scene(2, 'Church', ['TADE']), scene(3, 'River', ['ADA'])
  ]}]);
  const labels = out.scenes.map(s => s.scene_label);
  ok('our position prints, because nothing can collide with it',
     JSON.stringify(labels) === '["#1","#2","#3"]', JSON.stringify(labels));
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// NO SCENE IN THE SCRIPT IS LEFT OUT OF THE BREAKDOWN.
//
// The model sometimes returns fewer scenes than the script has. On THE
// WEAVER'S DAUGHTER it merged "3A. INT. LAGOS OFFICE — CORRIDOR —
// CONTINUOUS" into the scene above and returned five scenes for a
// six-scene script.
//
// Warning about it was the first answer and it was not good enough: a
// warning asks a production manager to go and find what we lost. The
// scene is not lost. We read its heading off the page, so we have its
// number, its location, its page and its eighths — everything except
// what the model would have added. So it goes back, in its own place,
// marked for what it lacks.
//
// A breakdown with a scene in it that has no cast listed is a scene an
// AD can see and ask about. A breakdown missing that scene is a day
// nobody books.
console.log('\nA scene the model dropped is put back');
{
  win.slateChunkHeads = [['INT. LAGOS OFFICE - DAY',
                          '3A. INT. LAGOS OFFICE - CORRIDOR - CONTINUOUS',
                          "INT. ADUKE'S WORKSHOP - NIGHT"]];
  win.slateChunkNumbers = [['3', '3A', '5']];
  const out = merge([{ scenes: [
    scene(3, 'Lagos Office', ['TOLANI']),
    scene(5, "Aduke's Workshop", ['ADUKE'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;

  ok('THREE scenes come out, not two', out.scenes.length === 3,
     out.scenes.length + ' — the script has three and so must the breakdown');
  ok('  ...and the restored one is in its own place, not at the end',
     out.scenes[1].scene_number === '3A',
     JSON.stringify(out.scenes.map(s => s.scene_number)));
  ok('it carries its number', out.scenes[1].scene_label === '3A',
     String(out.scenes[1].scene_label));
  // The LOCATION is where the unit travels; the SET is the room it
  // lights. A heading naming both gives both, and a call sheet that
  // collapses them sends a driver to "Lagos Office - Corridor".
  ok('  ...its location, read off the heading',
     /LAGOS OFFICE/i.test(out.scenes[1].location || ''), String(out.scenes[1].location));
  ok('  ...and its set, kept apart from the location',
     /CORRIDOR/i.test(out.scenes[1].set || ''), String(out.scenes[1].set));
  // DAY, not CONTINUOUS. The heading says CONTINUOUS, and a later pass
  // resolves that to the time it actually continues FROM — which is what
  // a breakdown must show, because nobody schedules a shoot day called
  // "continuous". A restored scene goes through that pass like any other.
  ok('  ...and a real time of day, not "CONTINUOUS"',
     out.scenes[1].time_of_day === 'DAY', String(out.scenes[1].time_of_day));
  ok('  ...and is marked as coming from the page',
     out.scenes[1].slate_from_page === true, JSON.stringify(out.scenes[1].slate_from_page));
  ok('  ...with no cast invented for it',
     (out.scenes[1].cast || []).length === 0, JSON.stringify(out.scenes[1].cast));

  ok('scene_index is renumbered so the schedule points at the right rows',
     JSON.stringify(out.scenes.map(s => s.scene_index)) === '[1,2,3]',
     JSON.stringify(out.scenes.map(s => s.scene_index)));
  ok('  ...and the total agrees', out.total_scenes === 3, String(out.total_scenes));
  ok('  ...and the reading records it',
     out.production_elements.slate_reading.scenes_restored_from_page === 1,
     String(out.production_elements.slate_reading.scenes_restored_from_page));

  const note = slateRestoredNote(out.slate_restored);
  ok('the note names the scene, not "some scenes"', /scene 3A/.test(note), note);
  ok('  ...and says where it came from', /read from your script/.test(note), note);
  ok('  ...and warns it has no cast or elements', /no cast or elements/.test(note), note);
}

console.log('\nAnd a clean breakdown says nothing at all');
{
  win.slateChunkHeads = [['INT. KITCHEN - DAY', 'EXT. MARKET - DAY']];
  win.slateChunkNumbers = [['1', '2']];
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']), scene(2, 'Market', ['ADA'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  ok('nothing restored', !out.slate_restored, JSON.stringify(out.slate_restored));
  ok('  ...and no note', slateRestoredNote(out.slate_restored) === null);
}

console.log('\nA (CONT\u2019D) heading is a page break, not a missing scene');
{
  win.slateChunkHeads = [['INT. KITCHEN - DAY',
                          "INT. KITCHEN - DAY (CONT'D)",
                          'EXT. MARKET - DAY']];
  win.slateChunkNumbers = [['1', '1', '2']];
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']), scene(2, 'Market', ['ADA'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  ok('no duplicate scene invented for a continuation', !out.slate_restored,
     JSON.stringify(out.slate_restored)
     + '  <- restoring a page break would invent a scene the script does not have');
}

// ══════════════════════════════════════════════════
// WHAT THE MODEL SAID, BEFORE WE EXTENDED IT.
//
// A scene_type opens a span that runs forward until the next type or a
// marked return, and with no return in the script, to the end of the
// film. iRANTI came back with 111 of 117 scenes shown as another time
// while only 37 carried a sequence type — the rest is span inheritance.
//
// Whether that is right turns on one fact: does the model type EVERY
// scene inside a flashback, or only the first? If every scene, the span
// mechanism is itself the fault. If only the first, spans are needed and
// merely need an ending.
//
// A stored breakdown cannot answer it, because by the time one is saved
// the span has overwritten the model's own answer. So it is counted
// before that happens, and one real run settles it instead of a guess.
console.log('\nThe model\u2019s own answer is counted before we extend it');
{
  win.slateChunkHeads = [['INT. KITCHEN - DAY', 'EXT. COMPOUND - DAY',
                          'INT. SCHOOL - DAY', 'INT. KITCHEN - NIGHT',
                          'EXT. ROAD - DAY']];
  win.slateChunkNumbers = [['1', '2', '3', '4', '5']];
  // The model typed ONE scene. Four end up typed, through inheritance.
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']),
    Object.assign(scene(2, 'Compound', ['ADA']), { scene_type: 'FLASHBACK' }),
    scene(3, 'School', ['ADA']), scene(4, 'Kitchen', ['ADA']),
    scene(5, 'Road', ['ADA'])
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  const r = out.production_elements.slate_reading;
  const typedAfter = out.scenes.filter(s => s.scene_type).length;

  ok('the MODEL typed one scene', r.scene_types_from_model === 1,
     String(r.scene_types_from_model));
  ok('  ...and four carry a type once we are done', typedAfter === 4,
     typedAfter + ' — the difference is the span, and it is the question');
  ok('one span was opened', r.spans_opened === 1, String(r.spans_opened));
  ok('  ...and it runs to the end of the film',
     r.spans_running_to_end === 1, String(r.spans_running_to_end)
     + ' — a flashback reaching the final scene is almost always wrong');
  ok('no return was marked in the script', r.returns_marked === 0,
     String(r.returns_marked));

  // The counts must describe the model, not us. If this ever reads 4 the
  // capture has moved after the span pass and answers nothing.
  ok('the count is the model\u2019s, not the result',
     r.scene_types_from_model !== typedAfter,
     'counted after the span, which is the one thing it must not do');
}

// ══════════════════════════════════════════════════
// THE PAGE NAMES THE PLACE, NOT THE MODEL.
//
// THE WEAVER'S DAUGHTER, 23 November. The script says "1. INT. ADUKE'S
// WORKSHOP - EARLY MORNING". The breakdown said "Aduke's House". Scene 5
// of the same script, the same room, said "Aduke's Workshop".
//
// One room became two locations: two rows in the location report, two
// groups in the schedule, and on any shoot longer than a day a company
// move to an address that does not exist. A 1st AD reading that call
// sheet sends a driver somewhere there is no set.
//
// This is the rule already applied to scene numbers. The page is the
// authority; the model is a reader of it.
console.log('\nThe location comes off the page');
{
  win.slateChunkHeads = [["1. INT. ADUKE'S WORKSHOP - EARLY MORNING",
                          '3A. INT. LAGOS OFFICE - CORRIDOR - CONTINUOUS',
                          "5. INT. ADUKE'S WORKSHOP - NIGHT"]];
  win.slateChunkNumbers = [['1', '3A', '5']];
  const out = merge([{ scenes: [
    // What the model actually returned for scene 1.
    Object.assign(scene(1, "Aduke's House", ['ADUKE']), { int_ext: 'INT' }),
    Object.assign(scene(2, 'Lagos Office', ['TOLANI']), { int_ext: 'INT' }),
    Object.assign(scene(3, "Aduke's Workshop", ['ADUKE']), { int_ext: 'INT' })
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;

  ok('scene 1 is at the workshop, as the script says',
     out.scenes[0].location === "Aduke's Workshop",
     String(out.scenes[0].location) + '  <- the model said "Aduke\u2019s House"');
  ok('  ...so scenes 1 and 5 are ONE location, not two',
     out.scenes[0].location === out.scenes[2].location,
     JSON.stringify([out.scenes[0].location, out.scenes[2].location])
     + '  <- two names for one room is a company move that does not exist');

  // And it reaches the document a location manager works from.
  const places = (out.outline_schedule || []).map(l => l.set_location);
  ok('the location report lists that room ONCE',
     places.filter(p => /workshop/i.test(p)).length === 1,
     JSON.stringify(places));
  ok('  ...and never under the model\u2019s name for it',
     !places.some(p => /house/i.test(p)), JSON.stringify(places));

  // The set stays separate from the location.
  ok('a heading naming both gives both',
     out.scenes[1].location === 'Lagos Office' && out.scenes[1].set === 'Corridor',
     JSON.stringify([out.scenes[1].location, out.scenes[1].set]));
}

console.log('\nBut only where the page actually says something');
{
  // An unplaced scene has no heading of ours to read, so the model's
  // answer stands. Better a name we are unsure of than no name at all.
  win.slateChunkHeads = [['INT. KITCHEN - DAY']];
  win.slateChunkNumbers = [['1']];
  const out = merge([{ scenes: [
    scene(1, 'Kitchen', ['ADA']),
    Object.assign(scene(2, 'Somewhere The Model Named', ['ADA']), { int_ext: 'EXT' })
  ]}]);
  win.slateChunkHeads = null; win.slateChunkNumbers = null;
  const kept = out.scenes.find(s => /Somewhere/i.test(s.location || ''));
  ok('an unmatched scene keeps the model\u2019s location', !!kept,
     JSON.stringify(out.scenes.map(s => s.location)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
