// The order a day is shot in — what comes OUT of slateDeriveSchedule.
//
//   node tests/dayorder-probe.js
//
// packer-probe checks the packer orders dawn, day, dusk, night. Nothing
// checked the step after it, which re-ordered every day on a cruder rule
// (day or night, grouped by set) and undid it. On THE WEAVER'S DAUGHTER
// (25 Nov) that put a DUSK exterior before a DAY exterior, and split one
// building — LAGOS OFFICE — into two places because a montage beat had no
// set of its own. This rebuilds that day exactly as it was printed.
const __p = require('path');
const { slateDeriveSchedule } = require(__p.join(__p.resolve(__dirname, '..'), 'netlify/functions/schedule.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

let idx = 0;
const sc = (n, ie, tod, loc, set, cast, eighths, beat) =>
  ({ idx: ++idx, key: beat ? '5:' + beat : String(idx), n, ie, tod, loc, set,
     eighths, cast, bg: '', sd: '1', beat: beat || 0, beats: beat ? 4 : 0 });

// As the breakdown reported them. Locations are what the day header printed.
const OFFICE = 'LAGOS OFFICE', WORKSHOP = "ADUKE'S WORKSHOP", MARKET = 'OJA TUNTUN MARKET';
const s3  = sc('3',  'INT', 'DAY',   OFFICE,   'Office',   ['TOLANI', 'MR BALOGUN', 'RECEPTIONIST'], 3);
const s3A = sc('3A', 'INT', 'DAY',   OFFICE,   'Corridor', ['TOLANI'], 1);
const s1  = sc('1',  'INT', 'DAY',   WORKSHOP, 'Workshop', ['ADUKE', 'TOLANI'], 4);
// Scene 4, the montage: four setups, no set of their own (set = location).
const m3  = sc('4', 'INT', 'DAY',  OFFICE,   'Lagos Office',      ['ADUKE', 'MR BALOGUN'], 1, 3);
const m1  = sc('4', 'INT', 'DAY',  WORKSHOP, "Aduke's Workshop",  ['ADUKE', 'MR BALOGUN'], 1, 1);
const m2  = sc('4', 'EXT', 'DAY',  MARKET,   'Oja Tuntun Market', ['ADUKE', 'MR BALOGUN'], 1, 2);
const m4  = sc('4', 'EXT', 'DUSK', "ADUKE'S COMPOUND", "Aduke's Compound", ['ADUKE', 'MR BALOGUN'], 1, 4);
const s2  = sc('2',  'EXT', 'DAY',   MARKET,   'Market Street', ['TOLANI'], 2);
const s5  = sc('5',  'INT', 'NIGHT', WORKSHOP, 'Workshop', ['ADUKE', 'TOLANI'], 3);

const all = [s3, s3A, s1, m3, m1, m2, m4, s2, s5];  // the order it was printed in
const breakdown = { title: "THE WEAVER'S DAUGHTER", character_breakdown: [
  { character: 'TOLANI', cast_number: 1 }, { character: 'ADUKE', cast_number: 2 },
  { character: 'MR BALOGUN', cast_number: 3 }, { character: 'RECEPTIONIST', cast_number: 4 }] };

const sched = slateDeriveSchedule([{ scenes: all.slice(), locations: [] }], breakdown,
  all, all, [], 'Tuesday 30 June 2026');
const day = sched.schedule[0];
const rows = day.scenes;
const tod = s => String(s.time_of_day || s.tod || '').toUpperCase();
const loc = s => String(s.location || s.loc || '').toUpperCase();
console.log('\n  Shooting order:');
rows.forEach(s => console.log('    ' + String(s.scene_number || s.n).padEnd(4) + tod(s).padEnd(6) + loc(s)
  + ' / ' + (s.set || '') + (s.setup ? '  (setup ' + s.setup + ')' : '')));

console.log("\nThe light runs forward: dawn, day, dusk, night");
const rank = t => /NIGHT/.test(t) ? 3 : /DUSK|SUNSET|EVENING/.test(t) ? 2 : /DAWN|SUNRISE/.test(t) ? 0 : 1;
const ranks = rows.map(s => rank(tod(s)));
ok('no scene is shot in earlier light than the one before it',
   ranks.every((r, i) => !i || r >= ranks[i - 1]), rows.map(tod).join(','));
ok('the dusk beat comes after every day scene, before the night',
   tod(rows[rows.length - 2]) === 'DUSK' && tod(rows[rows.length - 1]) === 'NIGHT');

console.log('\nOne trip per location within each band of light');
[1, 2, 3].forEach(r => {
  const band = rows.filter(s => rank(tod(s)) === r).map(loc);
  const visits = band.filter((l, i) => !i || l !== band[i - 1]);
  ok('band ' + r + ': each location visited once',
     new Set(visits).size === visits.length, visits.join(' → '));
});
ok('LAGOS OFFICE: scenes 3, 3A and the montage beat are one visit',
   (() => { const i = rows.map(loc).map((l, k) => l === OFFICE ? k : -1).filter(k => k >= 0);
            return i.length === 3 && i[2] - i[0] === 2; })());
ok("Scene 3 and 3A — same building, Office's set shot before the Corridor's",
   rows.findIndex(s => (s.scene_number || s.n) === '3') < rows.findIndex(s => (s.scene_number || s.n) === '3A'));

console.log('\nNothing lost, nothing added');
ok('nine units of work in, nine out', rows.length === 9, String(rows.length));

console.log('\ndayorder-probe      ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
