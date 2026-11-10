// slateDeriveSchedule — the contract.
//
// Everything here follows from ONE input: which scenes sit on which day.
// This test exists so that when a production manager starts moving scenes
// by hand, and later when a scheduler assigns around cast availability,
// both go through the same derivation and produce the same shape of truth.
// If any of these break, a call sheet is about to tell a crew something
// that is not so.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const { slateDeriveSchedule } = require(SCHEDULE_PATH);

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const scene = (idx, n, ie, tod, loc, set, cast, eighths) =>
  ({ idx, n, ie, tod, loc, set, eighths: eighths || 0, cast: cast || [], bg: '' });

// BAALE'S HOUSE: scenes 1 and 4 by day, scene 3 at night.
// MARKET: scene 2 by day.  Scene 5 has no location at all.
const s1 = scene(1, 1, 'INT', 'DAY',   "BAALE'S HOUSE", 'Sitting room', ['TADE', 'BIMBO'], 8);
const s2 = scene(2, 2, 'EXT', 'DAY',   'MARKET',        'Market',       ['TADE'], 4);
const s3 = scene(3, 3, 'INT', 'NIGHT', "BAALE'S HOUSE", 'Bedroom',      ['BIMBO'], 6);
const s4 = scene(4, 4, 'INT', 'DAY',   "BAALE'S HOUSE", 'Sitting room', ['TADE'], 2);
const s5 = scene(5, 5, 'INT', 'DAY',   '',              '',             ['KUNLE'], 3);

const slim     = [s1, s2, s3, s4, s5];
const placed   = [s1, s2, s3, s4];
const unplaced = [s5];
const breakdown = {
  title: 'LORI NKAN MI',
  character_breakdown: [
    { character: 'TADE',  cast_number: 1 },
    { character: 'BIMBO', cast_number: 2 },
    { character: 'KUNLE', cast_number: 3 }
  ]
};

// The assignment: day 1 holds the house, day 2 the market.
const days = [
  { scenes: [s3, s1, s4], locations: ["BAALE'S HOUSE"] },  // deliberately out of order
  { scenes: [s2],         locations: ['MARKET'] }
];

const sched = slateDeriveSchedule(days, breakdown, slim, placed, unplaced, 'Monday 30 June 2026');
const d1 = sched.schedule[0], d2 = sched.schedule[1];

console.log('\nShape');
ok('two shoot days', sched.total_shoot_days === 2, String(sched.total_shoot_days));
ok('counts every scene, placed or not', sched.total_scenes === 5, String(sched.total_scenes));
ok('scheduled + unscheduled = total',
   sched.scenes_scheduled + sched.unscheduled_scenes.length === sched.total_scenes,
   sched.scenes_scheduled + ' + ' + sched.unscheduled_scenes.length);
ok('days are numbered from 1', d1.day === 1 && d2.day === 2);

console.log('\nShooting order — day before night, and one trip per place');
ok('day 1 runs its DAY scenes before its NIGHT scene',
   d1.scenes.map(s => s.time_of_day).join(',') === 'DAY,DAY,NIGHT',
   d1.scenes.map(s => s.scene_number + ':' + s.time_of_day).join(' '));
ok('  ...and sorts ascending inside the place',
   d1.scenes[0].scene_number === 1 && d1.scenes[1].scene_number === 4,
   d1.scenes.map(s => s.scene_number).join(','));
ok('the night scene is not dropped', d1.scenes.length === 3, String(d1.scenes.length));

console.log('\nThe day header a crew drives to');
ok("day 1 header is the house", d1.location === "BAALE'S HOUSE", d1.location);
ok('day 2 header is the market', d2.location === 'MARKET', d2.location);
ok('neither day claims a company move', d1.company_move === false && d2.company_move === false,
   d1.company_move + '/' + d2.company_move);
ok('no scheduled scene is missing a location',
   d1.scenes_without_location === 0 && d2.scenes_without_location === 0);

console.log('\nDates follow the day order');
ok('day 1 takes the start date', /30 June 2026/.test(d1.date), d1.date);
ok('day 2 is the next day', /1 July 2026/.test(d2.date), d2.date);

console.log('\nCast release — the dangerous one');
const rel = {};
sched.cast_release_schedule.forEach(c => { rel[String(c.character).toUpperCase()] = c; });
ok('TADE works days 1 and 2',
   JSON.stringify((rel.TADE || {}).days_required) === '[1,2]',
   JSON.stringify((rel.TADE || {}).days_required));
ok('  ...and is released on day 2, not before', (rel.TADE || {}).release_day === 2,
   String((rel.TADE || {}).release_day));
ok('BIMBO works day 1 only', JSON.stringify((rel.BIMBO || {}).days_required) === '[1]',
   JSON.stringify((rel.BIMBO || {}).days_required));
ok('  ...and is released on day 1', (rel.BIMBO || {}).release_day === 1);
ok('an actor only in unplaceable scenes is still listed',
   !!rel.KUNLE && rel.KUNLE.unscheduled_only === true);
ok('  ...with no release day rather than a wrong one',
   rel.KUNLE && rel.KUNLE.release_day === null);
ok('listed in cast-number order, not discovery order',
   sched.cast_release_schedule.map(c => c.cast_number).join(',') === '1,2,3',
   sched.cast_release_schedule.map(c => c.cast_number).join(','));

console.log('\nUnplaceable scenes are reported, never silently dropped');
ok('scene 5 is reported unscheduled',
   sched.unscheduled_scenes.length === 1 && sched.unscheduled_scenes[0].scene_number === 5);
ok('  ...with a reason a producer can act on', /never states a location/i.test(sched.unscheduled_reason));

console.log('\nMoving a scene changes everything downstream');
// Same scenes, scene 4 moved to day 2 — the whole point of the refactor.
const moved = slateDeriveSchedule(
  [{ scenes: [s3, s1], locations: [] }, { scenes: [s2, s4], locations: [] }],
  breakdown, slim, placed, unplaced, 'Monday 30 June 2026');
const m1 = moved.schedule[0], m2 = moved.schedule[1];
ok('day 2 now carries two locations', m2.locations.length === 2, JSON.stringify(m2.locations));
ok('  ...and is flagged as a company move', m2.company_move === true);
ok('  ...with both in the header', /MARKET/.test(m2.location) && /BAALE/.test(m2.location), m2.location);
ok('day 1 header no longer claims the market', !/MARKET/.test(m1.location), m1.location);
const relMoved = {};
moved.cast_release_schedule.forEach(c => { relMoved[String(c.character).toUpperCase()] = c; });
ok('BIMBO is unaffected, still day 1',
   JSON.stringify(relMoved.BIMBO.days_required) === '[1]',
   JSON.stringify(relMoved.BIMBO.days_required));
ok('total scenes is unchanged by the move', moved.total_scenes === 5);
ok('locations are recomputed from the scenes, not taken on trust',
   m2.locations.length === 2 && JSON.stringify(days[1].locations) === '["MARKET"]');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
