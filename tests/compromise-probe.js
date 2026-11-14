// Compromise shoots — reported, never acted on.
//
// A production manager asked for this and was precise about why it must
// stay advisory: a production may already have agreed a compromise in a
// room Slate knows nothing about, and an optimiser that assumes it has
// the full picture will quietly undo it.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const { slateDeriveSchedule } = require(SCHEDULE_PATH);
const fs = require('fs');
const APP = fs.readFileSync(APP_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const sc = (idx, n, tod, loc, ie) => ({ idx, n, ie: ie || 'INT', tod, loc, set: loc, eighths: 4, cast: [], bg: '' });
const run = (days) => {
  const all = [].concat(...days.map(d => d.scenes));
  return slateDeriveSchedule(days.map(d => ({ scenes: d.scenes, locations: [] })),
    { title: 'T', character_breakdown: [] }, all, all, [], 'Monday 30 June 2026');
};

console.log('\nWhen there is something to say');
let s = run([{ scenes: [sc(1,1,'DAY',"BAALE'S COMPOUND"), sc(2,2,'NIGHT',"BAALE'S COMPOUND"), sc(3,3,'NIGHT',"BAALE'S COMPOUND")] }]);
let c = s.schedule[0].compromise_shoots;
ok('a set shot by day AND night is flagged', c.length === 1, JSON.stringify(c));
ok('  ...naming the location', c[0].location === "BAALE'S COMPOUND", c[0].location);
ok('  ...and every night scene at it', JSON.stringify(c[0].night_scenes) === '[2,3]', JSON.stringify(c[0].night_scenes));

console.log('\nWhen there is not');
s = run([{ scenes: [sc(1,1,'DAY','MARKET'), sc(2,2,'DAY','MARKET')] }]);
ok('day scenes only -> silent', s.schedule[0].compromise_shoots.length === 0);
s = run([{ scenes: [sc(1,1,'NIGHT','MARKET'), sc(2,2,'NIGHT','MARKET')] }]);
ok('night scenes only -> silent', s.schedule[0].compromise_shoots.length === 0);
s = run([{ scenes: [sc(1,1,'DAY','MARKET'), sc(2,2,'NIGHT','BAALE')] }]);
ok('day and night at DIFFERENT sets -> silent, nothing is saved by it',
   s.schedule[0].compromise_shoots.length === 0, JSON.stringify(s.schedule[0].compromise_shoots));
s = run([{ scenes: [sc(1,1,'DAY',''), sc(2,2,'NIGHT','')] }]);
ok('scenes with no location at all -> silent', s.schedule[0].compromise_shoots.length === 0);

console.log('\nExteriors count too — he was asked and said both');
s = run([{ scenes: [sc(1,1,'DAY','OJA STREET','EXT'), sc(2,2,'NIGHT','OJA STREET','EXT')] }]);
ok('an exterior day/night set is flagged', s.schedule[0].compromise_shoots.length === 1,
   JSON.stringify(s.schedule[0].compromise_shoots));

console.log('\nOne location spelled two ways is one location');
s = run([{ scenes: [sc(1,1,'DAY',"BAALE'S COMPOUND"), sc(2,2,'NIGHT','baales compound')] }]);
ok('matched on the place key, not the raw string',
   s.schedule[0].compromise_shoots.length === 1, JSON.stringify(s.schedule[0].compromise_shoots));

console.log('\nIt reports. It does not act.');
s = run([{ scenes: [sc(1,1,'NIGHT',"BAALE'S COMPOUND"), sc(2,2,'DAY',"BAALE'S COMPOUND"), sc(3,3,'DAY','MARKET')] }]);
ok('nothing is reordered — day still runs before night',
   s.schedule[0].scenes.map(x => x.time_of_day).join(',') === 'DAY,DAY,NIGHT',
   s.schedule[0].scenes.map(x => x.scene_number + ':' + x.time_of_day).join(' '));
ok('a night scene is STILL labelled NIGHT',
   s.schedule[0].scenes.filter(x => x.scene_number === 1)[0].time_of_day === 'NIGHT');
ok('no scene is dropped or duplicated', s.schedule[0].scenes.length === 3);

console.log('\nSeveral locations on one day');
s = run([{ scenes: [
  sc(1,1,'DAY','A'), sc(2,2,'NIGHT','A'),
  sc(3,3,'DAY','B'), sc(4,4,'NIGHT','B'),
  sc(5,5,'DAY','C') ] }]);
ok('each qualifying location gets its own entry',
   s.schedule[0].compromise_shoots.length === 2, JSON.stringify(s.schedule[0].compromise_shoots));
ok('  ...and the one that does not qualify is left out',
   !s.schedule[0].compromise_shoots.some(x => x.location === 'C'));

console.log('\nHow it reads in the workspace');
ok('rendered as an opportunity, not the warn colour used for faults',
   /compromise_shoots[\s\S]{0,700}gold-deep/.test(APP) &&
   !/compromise_shoots[\s\S]{0,700}var\(--warn/.test(APP));
ok('says it is a conversation for the director and DP',
   /one for your director and DP/.test(APP));
ok('singular and plural are handled', /scene ' : 'scenes '/.test(APP));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
