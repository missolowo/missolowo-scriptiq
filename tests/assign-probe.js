// slateAssignDays + slateDaysFromAssignment.
//
// The second one takes instructions from a browser about which scenes go
// on which shoot day. Everything it accepts ends up on a call sheet, so
// it refuses anything it cannot verify rather than doing its best.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const S = require(SCHEDULE_PATH);
const { slateAssignDays, slateDaysFromAssignment, slateDeriveSchedule } = S;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const scene = (idx, n, tod, loc, cast) =>
  ({ idx, n, ie: 'INT', tod, loc, set: loc, eighths: 4, cast: cast || [], bg: '' });

const s1 = scene(1, 1, 'DAY',   "BAALE'S HOUSE", ['TADE', 'BIMBO']);
const s2 = scene(2, 2, 'DAY',   'MARKET',        ['TADE']);
const s3 = scene(3, 3, 'NIGHT', "BAALE'S HOUSE", ['BIMBO']);
const s4 = scene(4, 4, 'DAY',   "BAALE'S HOUSE", ['TADE']);
const placed = [s1, s2, s3, s4];
const breakdown = { title: 'TEST', character_breakdown: [
  { character: 'TADE', cast_number: 1 }, { character: 'BIMBO', cast_number: 2 } ] };

console.log('\nThe packer still packs');
let days = slateAssignDays(placed, 2);
ok('produces days', Array.isArray(days) && days.length >= 1, JSON.stringify((days||[]).length));
ok('every scene lands somewhere',
   days.reduce((a, d) => a + d.scenes.length, 0) === 4,
   String(days.reduce((a, d) => a + d.scenes.length, 0)));
ok('no scene is duplicated',
   new Set([].concat(...days.map(d => d.scenes.map(s => s.idx)))).size === 4);

console.log('\nA valid assignment');
let r = slateDaysFromAssignment(placed, { 1: 1, 4: 1, 3: 1, 2: 2 });
ok('accepted', !r.error, r.error);
ok('two days', r.days.length === 2, String(r.days && r.days.length));
ok('day 1 holds three scenes', r.days[0].scenes.length === 3);
ok('day 2 holds one', r.days[1].scenes.length === 1);
ok('day 2 holds the right one', r.days[1].scenes[0].idx === 2);

console.log('\nEmpty days are kept, so dates do not silently shift');
r = slateDaysFromAssignment(placed, { 1: 1, 2: 1, 3: 1, 4: 3 });
ok('three days, not two', r.days.length === 3, String(r.days && r.days.length));
ok('day 2 is empty rather than missing', r.days[1].scenes.length === 0);
ok('day 3 still holds scene 4', r.days[2].scenes[0].idx === 4);

console.log('\nWhat it refuses, and whether it says why');
r = slateDaysFromAssignment(placed, { 1: 1, 2: 1 });
ok('a scene left out is refused', !!r.error, JSON.stringify(r.days && r.days.length));
ok('  ...and the message names the missing scenes',
   /3/.test(r.error) && /4/.test(r.error), r.error);

r = slateDaysFromAssignment(placed, { 1: 1, 2: 1, 3: 1, 4: 1, 99: 2 });
ok('a scene we do not have is refused', !!r.error, r.error);
ok('  ...and the message names it', /99/.test(r.error), r.error);

r = slateDaysFromAssignment(placed, { 1: 0, 2: 1, 3: 1, 4: 1 });
ok('day 0 is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, { 1: -2, 2: 1, 3: 1, 4: 1 });
ok('a negative day is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, { 1: 1.5, 2: 1, 3: 1, 4: 1 });
ok('half a day is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, { 1: '2', 2: 1, 3: 1, 4: 1 });
ok('a day sent as text is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, {});
ok('an empty assignment is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, null);
ok('no assignment at all is refused', !!r.error, r.error);
r = slateDaysFromAssignment(placed, [1, 1, 1, 1]);
ok('an array is refused', !!r.error, r.error);

console.log('\nNothing is ever silently lost');
r = slateDaysFromAssignment(placed, { 1: 1, 2: 1, 3: 1, 4: 1 });
ok('all four scenes on one day, accepted', !r.error && r.days[0].scenes.length === 4);
r = slateDaysFromAssignment(placed, { 1: 1, 2: 2, 3: 3, 4: 4 });
ok('all four on their own days, accepted', !r.error && r.days.length === 4);

console.log('\nEnd to end: a filmmaker moves a scene');
// Generated first: the packer decides.
const generated = slateDeriveSchedule(slateAssignDays(placed, 2), breakdown, placed, placed, [], 'Monday 30 June 2026');
ok('a generated schedule derives', generated.total_shoot_days >= 1);

// Then the production manager moves scene 4 to day 2 because TADE is away.
const moved = slateDaysFromAssignment(placed, { 1: 1, 3: 1, 2: 2, 4: 2 });
const after = slateDeriveSchedule(moved.days, breakdown, placed, placed, [], 'Monday 30 June 2026');
ok('the moved assignment derives', !moved.error && after.total_shoot_days === 2);
ok('day 2 now carries both places',
   after.schedule[1].locations.length === 2, JSON.stringify(after.schedule[1].locations));
ok('  ...and is flagged a company move', after.schedule[1].company_move === true);
ok('day 1 is only the house',
   after.schedule[0].locations.length === 1 && /BAALE/.test(after.schedule[0].location),
   after.schedule[0].location);
const rel = {};
after.cast_release_schedule.forEach(c => { rel[String(c.character).toUpperCase()] = c; });
ok('TADE works both days — he is in scene 1, still on day 1',
   JSON.stringify(rel.TADE.days_required) === '[1,2]' && rel.TADE.release_day === 2,
   JSON.stringify(rel.TADE.days_required) + ' rel=' + rel.TADE.release_day);
ok('BIMBO works day 1 only', JSON.stringify(rel.BIMBO.days_required) === '[1]');

// Now consolidate TADE onto one day — the reason a production manager
// moves scenes in the first place. His release day must move with him,
// because this is the number that tells a producer when to stop paying
// an actor, and getting it wrong in either direction costs real money.
const consolidated = slateDaysFromAssignment(placed, { 3: 1, 1: 2, 2: 2, 4: 2 });
const afterC = slateDeriveSchedule(consolidated.days, breakdown, placed, placed, [], 'Monday 30 June 2026');
const relC = {};
afterC.cast_release_schedule.forEach(c => { relC[String(c.character).toUpperCase()] = c; });
ok('consolidating TADE onto day 2 moves him off day 1',
   JSON.stringify(relC.TADE.days_required) === '[2]',
   JSON.stringify(relC.TADE.days_required));
ok('  ...and BIMBO now spans both days', JSON.stringify(relC.BIMBO.days_required) === '[1,2]',
   JSON.stringify(relC.BIMBO.days_required));
ok('  ...and nobody is released before a day they are called',
   afterC.cast_release_schedule.every(c =>
     !c.days_required.length || c.release_day >= Math.max.apply(null, c.days_required)));
ok('no scene was lost in the move', after.scenes_scheduled === 4, String(after.scenes_scheduled));
ok('day 1 keeps day-before-night order',
   after.schedule[0].scenes.map(s => s.time_of_day).join(',') === 'DAY,NIGHT',
   after.schedule[0].scenes.map(s => s.time_of_day).join(','));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
