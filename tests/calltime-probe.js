// Call times follow the shooting order — checked in code, not left to the model.
//
//   node tests/calltime-probe.js
//
// THE WEAVER'S DAUGHTER, Day 1 (25 Nov): the day opened on scene 3 with
// Tolani, Mr Balogun and the Receptionist. The model called Tolani at 07:00
// and the other two at 09:00 — two hours after the scene they open the day
// with. This runs the real guard from callsheet.js on those exact times.
const fs = require('fs');
const path = require('path');
const { slateKey } = require(path.join(__dirname, '..', 'netlify/functions/lib/slate-core'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/callsheet.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const start = SRC.indexOf('(function slateCallOrder() {');
ok('the guard exists in callsheet.js', start >= 0);
let d = 0, end = -1;
for (let j = SRC.indexOf('{', start); j < SRC.length; j++) {
  if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { end = SRC.indexOf(';', j) + 1; break; } }
}
const guard = new Function('scenesToday', 'castCallTimes', 'castKey', SRC.slice(start, end));
ok('the guard runs after the cast list is built, before it is sorted for print',
   SRC.indexOf('const castCallTimes = castToday.map') < start && start < SRC.indexOf('castCallTimes.sort('));

const run = (scenes, times) => { const c = JSON.parse(JSON.stringify(times)); guard(scenes, c, slateKey); return c; };
const by = (list) => Object.fromEntries(list.map(c => [c.character, c.call_time + '/' + c.on_set]));

console.log('\nThe Weaver\'s Daughter, Day 1, as the model wrote it');
const scenes = [
  { scene_number: '3',  cast: ['TOLANI', 'MR BALOGUN', 'RECEPTIONIST'] },
  { scene_number: '3A', cast: ['TOLANI'] },
  { scene_number: '1',  cast: ['ADUKE', 'TOLANI'] },
  { scene_number: '5',  cast: ['ADUKE', 'TOLANI'] }];
const out = by(run(scenes, [
  { character: 'Tolani',       call_time: '07:00', on_set: '08:00' },
  { character: 'Aduke',        call_time: '07:00', on_set: '08:00' },
  { character: 'Mr Balogun',   call_time: '09:00', on_set: '10:00' },
  { character: 'Receptionist', call_time: '09:00', on_set: '10:00' }]));
ok('Mr Balogun, in the first scene, is called with the earliest call', out['Mr Balogun'] === '07:00/08:00', out['Mr Balogun']);
ok('the Receptionist too', out['Receptionist'] === '07:00/08:00', out['Receptionist']);
ok('Tolani unchanged', out['Tolani'] === '07:00/08:00', out['Tolani']);
ok('Aduke (third scene) keeps the model\'s time — it already obeys the rules', out['Aduke'] === '07:00/08:00', out['Aduke']);

console.log('\nA good stagger is left alone');
const good = by(run(scenes, [
  { character: 'Tolani',       call_time: '06:30', on_set: '07:30' },
  { character: 'Mr Balogun',   call_time: '06:30', on_set: '07:30' },
  { character: 'Receptionist', call_time: '06:30', on_set: '07:30' },
  { character: 'Aduke',        call_time: '09:00', on_set: '10:00' }]));
ok('Aduke, not working until the third scene, may come in later', good['Aduke'] === '09:00/10:00', good['Aduke']);

console.log('\nNobody is called after someone who works later than them');
const inv = by(run([{ cast: ['A'] }, { cast: ['B'] }, { cast: ['C'] }], [
  { character: 'A', call_time: '07:00', on_set: '08:00' },
  { character: 'B', call_time: '11:00', on_set: '12:00' },
  { character: 'C', call_time: '09:00', on_set: '10:00' }]));
ok('B (second scene) is brought forward to C\'s time', inv['B'] === '09:00/10:00', inv['B']);
ok('C keeps its time', inv['C'] === '09:00/10:00', inv['C']);

console.log('\nA time the model wrote badly is left as written, not guessed');
const bad = by(run(scenes, [{ character: 'Mr Balogun', call_time: 'early', on_set: '' },
  { character: 'Tolani', call_time: '07:00', on_set: '08:00' }]));
ok('an unreadable time is not replaced', bad['Mr Balogun'] === 'early/', bad['Mr Balogun']);

console.log('\ncalltime-probe      ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
