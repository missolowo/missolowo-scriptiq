// A montage is one scene, and several units of work.
//
//   node tests/montage-schedule-probe.js
//
// WHY THIS FILE EXISTS
//
// The breakdown is right to call a montage one scene: the writer wrote one
// scene and the page is the authority. The SCHEDULE cannot, because a
// montage's setups are in different places. Four beats across a workshop,
// a market, an office and a compound came through as ONE row at whichever
// location won, and no unit travels to four places to shoot a montage —
// they pick up the market beat on the market day.
//
// `montage_beats` held those setups all along and the scheduler never saw
// them. They are built in app.html, printed on the breakdown and call
// sheet PDFs, and slimScenes never carried them. The same shape as
// story_day and the eighths: computed, then dropped at the boundary.
//
// WHAT THIS PROBE IS REALLY FOR
//
// This change alters what CONSERVATION MEANS, and conservation is the one
// thing in this product I would least like to get wrong — it is the guard
// that closed the "missing scene 4". The guarantee moves from "every scene
// placed exactly once" to "every UNIT placed exactly once", where a unit
// is a scene or a montage setup. That is strictly stronger: a montage used
// to be one row with its four setups unaccounted for anywhere.
//
// So conservation is asserted first and under every shape I can build.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const SCHED = fs.readFileSync(__p.join(ROOT, 'netlify/functions/schedule.js'), 'utf8');
const { slateAssignDays, slateDaysFromAssignment } = require(__p.join(ROOT, 'netlify/functions/schedule.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(src, needle) {
  const s = src.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let d = 0, end = -1;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  return src.slice(s, end);
}

// The real enrichment, with its real dependencies. A stub here would test
// nothing: the whole point is that slateParseHeading reads a beat line.
const enrich = new Function(
  block(APP, 'function slateTitleCase') + '\n'
  + block(APP, 'function slateKey') + '\n'
  + block(APP, 'function slateSplitWorthIt') + '\n'
  + ['var SLATE_HEAD =', 'var SLATE_NUM  =', 'var SLATE_SEQUENCE'].map(function (n) {
      const i = APP.indexOf(n); return APP.slice(i, APP.indexOf(';', i) + 1);
    }).join('\n') + '\n'
  + block(APP, 'function slateOpeningWord') + '\n'
  + block(APP, 'function slateParseHeading') + '\n'
  + block(APP, 'function slateBreakdownForSchedule') + '\n'
  + '; return slateBreakdownForSchedule;')();

// ══════════════════════════════════════════════════
console.log('\nA beat line is read into a real place');
{
  const bd = enrich({ scenes: [{
    scene_index: 5, scene_number: '4', scene_type: 'MONTAGE',
    location: 'Various Locations', slate_eighths: 12,
    // As the product stores them. slateMontageBeat strips the leading dash
    // at read time — app.html:2431 pushes beat.text — so these are what
    // montage_beats actually holds. An earlier version of this probe fed
    // dash-prefixed lines, which the product never produces, and reported
    // four failures against correct code.
    montage_beats: [
      "INT. ADUKE'S WORKSHOP — DAY",
      'EXT. OJA TUNTUN MARKET — MORNING',
      'INT. LAGOS OFFICE — DAY',
      "EXT. ADUKE'S COMPOUND — DUSK"
    ]
  }]});
  const setups = bd.scenes[0].montage_setups;

  ok('one setup per beat', setups.length === 4, String(setups && setups.length));
  ok('each setup knows where it is',
     setups.map(u => u.location).every(Boolean),
     JSON.stringify(setups.map(u => u.location)));
  ok('  ...and the places are the beats’ own, not the montage’s',
     setups[1].location.toUpperCase().indexOf('MARKET') >= 0
     && setups[0].location.toUpperCase().indexOf('ADUKE') >= 0,
     JSON.stringify(setups.map(u => u.location))
     + ' — "Various Locations" is not a place a unit can drive to');
  ok('each setup knows its time of day',
     setups[3].time_of_day.toUpperCase().indexOf('DUSK') >= 0,
     JSON.stringify(setups.map(u => u.time_of_day)));
  ok('  ...and its interior or exterior',
     setups[1].int_ext === 'EXT' && setups[0].int_ext === 'INT',
     JSON.stringify(setups.map(u => u.int_ext))
     + ' — the montage says nothing about INT/EXT, but its beat lines do');
  ok('the beats are numbered from one', setups.map(u => u.n).join() === '1,2,3,4');

  // The breakdown a filmmaker has open must not change because they asked
  // for a schedule.
  const original = { scenes: [{ scene_index: 5, montage_beats: ['INT. A — DAY'] }] };
  const copy = enrich(original);
  ok('the filmmaker’s own breakdown is not mutated',
     original.scenes[0].montage_setups === undefined && copy !== original,
     'asking for a schedule must not rewrite the breakdown');
}

console.log('\nAn ordinary scene is untouched');
{
  const bd = enrich({ scenes: [
    { scene_index: 1, location: 'Workshop' },
    { scene_index: 2, location: 'Market', montage_beats: [] }
  ]});
  ok('no setups are invented',
     bd.scenes[0].montage_setups === undefined
     && bd.scenes[1].montage_setups === undefined,
     'only a montage has setups');
  ok('  ...and the scene object is passed straight through',
     bd.scenes[0].location === 'Workshop');
}

console.log('\nA montage is only split when splitting buys something');
{
  // THE HILLS BETWEEN US scene 30A: seven beats, none of them a place.
  // They have nowhere to be scheduled to, so they always travel together,
  // and splitting them put seven rows on the board, seven part labels and
  // seven lines on a call sheet for one piece of work. A part is a
  // location visit; where there is no location there is no part.
  const prose = enrich({ scenes: [{ scene_index: 9, scene_number: '30A',
    montage_beats: ['she remembers the rain', 'the loom stands still',
                    'a letter goes unopened'] }]});
  ok('prose beats do not split the scene',
     prose.scenes[0].montage_setups === undefined,
     JSON.stringify(prose.scenes[0].montage_setups));

  const onePlace = enrich({ scenes: [{ scene_index: 9, montage_beats: [
    'INT. KITCHEN — DAY', 'INT. KITCHEN — NIGHT' ]}]});
  ok('one place does not split it either',
     onePlace.scenes[0].montage_setups === undefined,
     'the unit makes one trip, so there is nothing for a part label to '
     + 'tell a production manager apart');

  const spread = enrich({ scenes: [{ scene_index: 9, montage_beats: [
    'INT. KITCHEN — DAY', 'EXT. ROAD — DUSK' ]}]});
  ok('two places do split it',
     (spread.scenes[0].montage_setups || []).length === 2,
     'scene 63 of THE HILLS BETWEEN US visits ten real locations, and a '
     + '1st AD has to know which visit shoots when');
}

console.log('\nA beat with no readable heading still travels');
{
  // Written as the splitter actually emits them: the dash prefix this
  // fixture used is not something the product produces, and with it no
  // beat parses as a place — so the montage collapsed and the assertion
  // below was testing the fixture rather than the code.
  const bd = enrich({ scenes: [{ scene_index: 9, montage_beats: [
    'INT. KITCHEN — DAY', 'she remembers the rain', 'EXT. ROAD — DUSK'
  ]}]});
  const setups = bd.scenes[0].montage_setups;
  ok('every beat still becomes a setup', setups.length === 3, String(setups.length));
  ok('  ...and the unreadable one simply has no location',
     setups[1].location === '' && setups[1].text.indexOf('remembers') > 0,
     JSON.stringify(setups[1])
     + ' — dropped, it would be a setup nobody shoots');
}

// ══════════════════════════════════════════════════
// CONSERVATION. The reason this file exists.
console.log('\nEvery unit of work reaches exactly one day');
{
  // Units as slimScenes builds them: a montage contributes one per setup.
  const unit = (idx, beat, beats, loc, tod, e) => ({
    idx: idx, key: beat ? (idx + ':' + beat) : String(idx),
    beat: beat || 0, beats: beats || 0, n: String(idx), label: String(idx),
    loc: loc, tod: tod, ie: 'INT', eighths: e || 8, cast: [], bg: '', sd: ''
  });

  const shapes = {
    'a montage across four places': () => [
      unit(1, 0, 0, 'Workshop', 'DAY'),
      unit(2, 1, 4, 'Workshop', 'DAY', 3), unit(2, 2, 4, 'Market', 'MORNING', 3),
      unit(2, 3, 4, 'Office', 'DAY', 3), unit(2, 4, 4, 'Compound', 'DUSK', 3),
      unit(3, 0, 0, 'Workshop', 'NIGHT')
    ],
    'every beat at one place': () => [
      unit(1, 1, 3, 'Workshop', 'DAY', 3), unit(1, 2, 3, 'Workshop', 'DAY', 3),
      unit(1, 3, 3, 'Workshop', 'DAY', 3)
    ],
    'two montages interleaved': () => [
      unit(1, 1, 2, 'A', 'DAY', 4), unit(1, 2, 2, 'B', 'DAY', 4),
      unit(2, 1, 2, 'B', 'NIGHT', 4), unit(2, 2, 2, 'C', 'NIGHT', 4)
    ],
    'a montage whose beats have no location': () => [
      unit(1, 1, 2, '', 'DAY', 4), unit(1, 2, 2, '', 'DAY', 4),
      unit(2, 0, 0, 'Workshop', 'DAY')
    ],
    'nothing but montage': () => Array.from({ length: 12 }, (_, i) =>
      unit(1 + Math.floor(i / 4), (i % 4) + 1, 4, 'Place ' + (i % 3), 'DAY', 3))
  };

  Object.keys(shapes).forEach(function (name) {
    [1, 2, 5, 12].forEach(function (dayCount) {
      const units = shapes[name]();
      const days = slateAssignDays(units.map(u => Object.assign({}, u)), dayCount);
      const out = days.reduce((a, d) => a.concat(d.scenes), []);
      const keys = out.map(s => s.key).sort();
      const want = units.map(s => s.key).sort();
      ok('  ' + name + ', ' + dayCount + ' day(s)',
         JSON.stringify(keys) === JSON.stringify(want)
         && new Set(keys).size === keys.length,
         out.length + ' of ' + units.length
         + (new Set(keys).size !== keys.length ? ' — A SETUP IS ON TWO DAYS' : ''));
    });
  });
}

console.log('\nA montage’s setups land where they actually are');
{
  const unit = (idx, beat, beats, loc, tod) => ({
    idx: idx, key: beat ? (idx + ':' + beat) : String(idx), beat: beat, beats: beats,
    n: String(idx), label: String(idx), loc: loc, tod: tod, ie: 'INT',
    eighths: 4, cast: [], bg: '', sd: ''
  });
  // The montage's beats share locations with ordinary scenes. Each beat
  // should go to the day already visiting its place.
  const units = [
    unit(1, 0, 0, 'Workshop', 'DAY'), unit(2, 0, 0, 'Market', 'DAY'),
    unit(3, 1, 2, 'Workshop', 'DAY'), unit(3, 2, 2, 'Market', 'DAY')
  ];
  const days = slateAssignDays(units, 2);
  const placeOf = {};
  days.forEach(function (d, i) {
    d.scenes.forEach(function (s) { placeOf[s.key] = i; });
  });
  ok('the workshop beat shares a day with the workshop scene',
     placeOf['3:1'] === placeOf['1'],
     JSON.stringify(placeOf) + ' — picking a beat up where the unit already '
     + 'is, is the whole reason to split a montage');
  ok('the market beat shares a day with the market scene',
     placeOf['3:2'] === placeOf['2'], JSON.stringify(placeOf));
}

// ══════════════════════════════════════════════════
console.log('\nMoving a montage by hand does not break the schedule');
{
  const unit = (idx, beat) => ({
    idx: idx, key: beat ? (idx + ':' + beat) : String(idx), beat: beat || 0,
    n: String(idx), loc: 'A', tod: 'DAY', eighths: 8
  });
  const placed = [unit(1, 0), unit(2, 1), unit(2, 2), unit(2, 3)];

  // The workspace addresses a montage by its SCENE index, which means
  // "move the whole montage". Without a fallback, one key arrived for
  // three units and the filmmaker got "these scenes were left out".
  const whole = slateDaysFromAssignment(placed, { '1': 1, '2': 2 });
  ok('a scene-index assignment moves all three setups together',
     !whole.error && whole.days && whole.days.length === 2
     && whole.days[1].scenes.length === 3,
     whole.error || JSON.stringify((whole.days || []).map(d => d.scenes.map(s => s.key))));

  // And a unit-level assignment moves one setup, for when the workspace
  // can address them. This was rejected outright at first: `known` was
  // keyed on the scene index alone, so every unit key read as "a scene
  // this breakdown does not have".
  const single = slateDaysFromAssignment(placed,
    { '1': 1, '2:1': 1, '2:2': 2, '2:3': 2 });
  ok('a unit-level assignment moves one setup',
     !single.error && single.days
     && single.days[0].scenes.length === 2
     && single.days[1].scenes.length === 2,
     single.error || JSON.stringify((single.days || []).map(d => d.scenes.map(s => s.key))));

  // Conservation still refuses rather than repairs.
  const short = slateDaysFromAssignment(placed, { '1': 1 });
  ok('a setup left out of the assignment is still refused',
     !!short.error, JSON.stringify(short).slice(0, 90)
     + ' — refused rather than repaired, as before');
}

console.log('\nThe schedule says which setup a row is');
{
  ok('the row carries the setup number and the total',
     /montage_setup: s\.beat \|\| 0/.test(SCHED)
     && /montage_setups: s\.beats \|\| 0/.test(SCHED),
     'a 1st AD reading "4" has to know they are shooting one beat of it today');
  ok('  ...and the beat line itself', /montage_beat: s\.beat_text/.test(SCHED));
  ok('  ...and the unit key, so one setup can be moved later',
     /unit: s\.key \|\| String\(s\.idx\)/.test(SCHED));
  ok('an unplaced setup is marked the same way',
     (SCHED.match(/montage_setup: s\.beat \|\| 0/g) || []).length === 2,
     'a setup the script never placed must not lose which montage it is from');
}

console.log('\nThe filmmaker’s scene count is still the breakdown’s');
{
  // total_scenes must not rise because a montage became four rows. A count
  // three higher than their breakdown reads as the schedule inventing
  // scenes, which is the complaint the run stamp and the continuation
  // count were added to prevent.
  ok('scenes are counted by scene, not by unit of work',
     /uniqueScenes\[String\(s\.idx\)\] = true/.test(SCHED)
     && /uniqueUnits\[String\(s\.key \|\| s\.idx\)\] = true/.test(SCHED),
     'one montage is one scene of their screenplay however many setups it has');
  ok('  ...and total_scenes reports the scene count',
     /total_scenes: Object\.keys\(uniqueScenes\)\.length/.test(SCHED));
}

console.log('\nA montage’s page count is not multiplied by its beats');
{
  // The writer wrote one scene of that length. Charging the whole montage
  // to every beat would make a four-beat montage four times its real page
  // count, and the day budget is now pages.
  const slim = block(SCHED, 'function slateSlimOne');
  ok('the eighths are shared across the parts',
     /slateShareEighths\(Number\(s\.slate_eighths\) \|\| 0,/.test(slim),
     'four parts of a 12/8 montage is 12/8 of work, not 48/8');

  // The shares have to SUM to the scene, which the old floor of one eighth
  // did not. THE WEAVER'S DAUGHTER: scene 4 is 2/8 split four ways, printed
  // 1/8 four times, so the schedule said the film was 2 1/8 pages and the
  // breakdown said 1 7/8. Page count is the budget days are assigned
  // against, so on a ten-part montage that invents a shoot day.
  const share = new Function(block(SCHED, 'function slateShareEighths')
    + '; return slateShareEighths;')();
  [[2, 4], [4, 10], [8, 4], [15, 4], [0, 3], [1, 1], [7, 2]].forEach(function (c) {
    var parts = [];
    for (var i = 1; i <= c[1]; i++) parts.push(share(c[0], c[1], i));
    var sum = parts.reduce(function (a, b) { return a + b; }, 0);
    ok('  ' + c[0] + '/8 over ' + c[1] + ' parts sums to ' + c[0],
       sum === c[0], parts.join(',') + ' = ' + sum);
  });
  ok('  ...the remainder going to the earliest parts',
     share(2, 4, 1) === 1 && share(2, 4, 4) === 0,
     'a part that works out to nothing carries nothing: a quarter of an '
     + 'eighth IS less than an eighth, and the day has to add up to the film');

  // The old assertion here said a free part lets a day absorb any number of
  // them. It cannot: the packer carries two ceilings, and a zero-page part
  // still fills a scene slot in the first.
  ok('a part with no pages is still capped by the scene-count budget',
     /current\.scenes\.length \+ p\.scenes\.length > perDay/.test(SCHED),
     'pages is the real budget, but it is not the only one');
}

console.log('\nOne beat is not worth splitting');
{
  ok('a montage with a single setup schedules as a scene',
     /if \(setups\.length > 1\)/.test(SCHED),
     'splitting one beat into one unit adds a label and no information');
}

// ══════════════════════════════════════════════════
// FOUND BY RENDERING THE DOCUMENTS AND READING THEM.
console.log('\nA split montage does not make its own call sheet "out of date"');
{
  // A day holding two beats of scene 4 lists scene_index 5 twice. The call
  // sheet lists that montage ONCE, which is right — it is one scene of the
  // screenplay with today's setups named underneath.
  //
  // Comparing the raw lists made "5,5,6" and "5,6" disagree, so every day
  // containing a split montage declared its own call sheet stale and
  // refused to export it. The export simply hung behind an alert().
  const stale = block(APP, 'function slateCallsheetOutOfDate');
  ok('the comparison is on DISTINCT scene indexes',
     /var seen = \{\};/.test(stale) && /Object\.keys\(seen\)\.map\(Number\)/.test(stale),
     'a montage appears once on the sheet and several times on the day');
  ok('  ...and still catches a day whose scenes really changed',
     /ids\(day\.scenes\) !== ids\(slateCallsheet\.scenes_today\)/.test(stale),
     'the guard that refuses a stale sheet must keep working');
}

console.log('\nThe labels fit the column they are drawn in');
{
  // labelledList draws its values at x+26. A longer label prints straight
  // through them, which is how Report 5 came out unreadable and how
  // "2 of 4 setups today" overlapped its first beat line.
  // 'Parts' since 25 Nov, to match "4 pt 3" — what matters is that it is short.
  ok('the call sheet setup label is short',
     (/pdf\.labelledList\('(\w+)', csSetups/.exec(APP) || [, 'x'.repeat(99)])[1].length <= 6,
     'the count belongs on each line, where it says WHICH setup rather '
     + 'than only how many');
  ok('the schedule does not print the beat on a line of its own',
     !/labelledList\('beat',/.test(APP),
     'slugline() leaves y where it was, so a list after it printed through '
     + 'the scene numeral — and the row already carries the beat’s own '
     + 'location, so it was the same fact twice');
}

console.log('\nThe parsing happens once, in app.html');
{
  ok('schedule.js does not parse a beat line',
     !/slateParseHeading/.test(SCHED),
     'a second parser in the function is the duplicate source of truth that '
     + 'produced the scene numbers, the locations, the montage and the span');
  ok('both schedule call sites send the enriched breakdown',
     (APP.match(/slateBreakdownForSchedule\(slateBreakdown\)/g) || []).length === 2,
     (APP.match(/slateBreakdownForSchedule\(slateBreakdown\)/g) || []).length
     + ' of 2 — a hand-moved scene must not re-collapse the montage');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
