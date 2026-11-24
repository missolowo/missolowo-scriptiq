// What a unit needs to find the day, and what it was not told.
//
//   node tests/logistics-probe.js
//
// WHY THIS FILE EXISTS
//
// Four things a crew asks for were on no document Slate produces: crew
// parking, catering and meal location, transport, and any detail of a
// unit move. The safety notes promise a meal break within six hours and
// nothing said where it is served. Thirty vehicles arrive at a
// residential compound with nowhere stated to put them.
//
// Three of those are data we cannot know — the filmmaker's to supply,
// like the hospital and base camp already in Production Details.
//
// THE MOVE IS DIFFERENT, AND IT IS THE POINT OF THIS FILE
//
// company_move was a boolean, computed as locations.length > 1. It told a
// crew there was a move somewhere in the day — which they had already
// worked out from the two locations printed at the top of their call
// sheet. Meanwhile the schedule held the day in shooting order, so it
// knew WHICH scene the unit moves after and from where to where. That is
// the sentence a 1st AD writes by hand, and it was derivable all along.
//
// It is only reliable because the day is ordered by light and location
// now rather than by the order pieces happened to be pushed. Before that,
// "move after scene 3A" could have named any scene on the day.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const CS = fs.readFileSync(__p.join(ROOT, 'netlify/functions/callsheet.js'), 'utf8');
const SCHED = fs.readFileSync(__p.join(ROOT, 'netlify/functions/schedule.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// The derivation, run for real against days shaped like the packer builds.
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

// Pull the company_moves expression out of schedule.js and run it, so this
// tests the shipped derivation rather than a copy of it.
const movesSrc = (function () {
  const i = SCHED.indexOf('company_moves: (function () {');
  const start = SCHED.indexOf('(function () {', i);
  let d = 0, end = -1;
  for (let j = SCHED.indexOf('{', start); j < SCHED.length; j++) {
    if (SCHED[j] === '{') d++;
    else if (SCHED[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  return SCHED.slice(start, SCHED.indexOf(')', end) + 1);
})();

// slatePlaceKey lives in schedule.js, not in slate-core — the grouping's
// own idea of "one place". Pulled from the same file as the derivation so
// the probe cannot test them against different definitions.
const { slateKey } = require(__p.join(ROOT, 'netlify/functions/lib/slate-core.js'));
const slatePlaceKey = new Function('slateKey',
  block(SCHED, 'function slatePlaceKey') + '; return slatePlaceKey;')(slateKey);
// The slice ends at the closing paren of the IIFE's function expression,
// so it has to be invoked here. Without the call this returned the
// function itself, whose .length is its arity — 0 — which read exactly
// like "no moves found".
const movesOf = new Function('d', 'slatePlaceKey', 'return (' + movesSrc + ')();');
const sc = (n, loc) => ({ idx: n, n: String(n), label: String(n), loc: loc, tod: 'DAY' });

// ══════════════════════════════════════════════════
console.log('\nA move is a sentence, not a flag');
{
  const m = movesOf({ scenes: [sc(1, 'Lagos Office'), sc(2, 'Lagos Office'),
                               sc(3, 'Oja Tuntun Market')] }, slatePlaceKey);
  ok('one move is found', m.length === 1, JSON.stringify(m));
  ok('  ...after the last scene at the old place',
     m[0].after_scene === '2', JSON.stringify(m[0])
     + ' — that is the moment the unit actually travels');
  ok('  ...naming where from and where to',
     m[0].from === 'Lagos Office' && m[0].to === 'Oja Tuntun Market',
     JSON.stringify(m[0]));
  ok('  ...and the scene’s identity, not only its number',
     m[0].after_scene_index === 2, JSON.stringify(m[0]));
}

console.log('\nA day at one place has no move');
{
  ok('no move is invented',
     movesOf({ scenes: [sc(1, 'Workshop'), sc(2, 'Workshop')] }, slatePlaceKey).length === 0);
  ok('  ...nor on a single scene',
     movesOf({ scenes: [sc(1, 'Workshop')] }, slatePlaceKey).length === 0);
  ok('  ...nor on an empty day',
     movesOf({ scenes: [] }, slatePlaceKey).length === 0
     && movesOf({}, slatePlaceKey).length === 0);
}

console.log('\nTwo spellings of one place are not a move');
{
  // The whole grouping exists so a unit visits a place once. If the move
  // derivation disagreed with the grouping about what "one place" means,
  // it would print a move the schedule deliberately avoided.
  const m = movesOf({ scenes: [sc(1, "Aduke's House"), sc(2, 'ADUKE’S HOUSE')] },
                    slatePlaceKey);
  ok('it uses the same place key as the grouping', m.length === 0,
     JSON.stringify(m) + ' — a move the schedule did not make');
}

console.log('\nA scene the script never placed moves nobody');
{
  // It is reported separately and scheduled at the end of its day.
  // Treating it as a location would invent travel to nowhere.
  const m = movesOf({ scenes: [sc(1, 'Workshop'), sc(2, ''), sc(3, 'Workshop')] },
                    slatePlaceKey);
  ok('an unplaced scene does not create two moves', m.length === 0,
     JSON.stringify(m));
}

console.log('\nSeveral moves in one day are all named');
{
  const m = movesOf({ scenes: [sc(1, 'A'), sc(2, 'B'), sc(3, 'C')] }, slatePlaceKey);
  ok('two moves', m.length === 2, JSON.stringify(m));
  ok('  ...in the order they happen',
     m[0].to === 'B' && m[1].from === 'B' && m[1].to === 'C',
     JSON.stringify(m));
}

// ══════════════════════════════════════════════════
console.log('\nIt reaches the documents');
{
  ok('the schedule derives it', /company_moves: \(function/.test(SCHED));
  ok('the call sheet carries it',
     /company_moves: Array\.isArray\(dayData\.company_moves\)/.test(CS));
  ok('  ...and tomorrow’s, on the advance',
     /company_moves: Array\.isArray\(slateNextDay\.company_moves\)/.test(CS),
     'the advance is read to know what to prepare, and a move is what most '
     + 'changes a morning');
  ok('the call sheet PDF prints the sentence',
     /csMoves\.length > 1 \? 'Unit Moves' : 'Unit Move'/.test(APP));
  ok('  ...naming the scene it follows',
     /'After scene ' \+ m\.after_scene/.test(APP));
  ok('the advance prints which way the unit travels',
     /Company move tomorrow: '/.test(APP),
     '"more than one location" does not help anyone plan travel tonight');
  ok('  ...and an older schedule still gets the old wording',
     /else if \(adv\.company_move\)/.test(APP),
     'a call sheet built before this change has no moves list');
}

console.log('\nThe move reads in the PDF’s own font');
{
  // U+2192 is not in the font the PDF embeds. It printed as "!'" on the
  // page — "After scene 4: Oja Tuntun Market !' Lagos Office" — and no
  // assertion could have seen it. Found by rendering the call sheet and
  // reading it, which is the third time that has caught something today.
  // Comments are fine — they never reach a page. The first version of
  // this assertion banned the character outright and failed on five
  // explanatory comments, which is an assertion crying wolf about itself.
  const code = APP.split('\n')
    .map(function (l) { return l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, ''); })
    .join('\n');
  ok('no right-arrow character in any string that reaches a page',
     code.indexOf('→') < 0 && code.indexOf('\\u2192') < 0,
     'the PDF font does not carry it, and it renders as punctuation');
  ok('the move says "to" instead',
     /' to ' \+ \(m\.to \|\| 'next location'\)/.test(APP),
     'a word also reads aloud, which matters on a document people quote '
     + 'down a phone');
}

console.log('\nThe travel estimate is never guessed');
{
  ok('it is only printed when the filmmaker supplies one',
     /pd\.travel_estimate \? '   \(allow ' \+ pd\.travel_estimate/.test(APP),
     'a wrong travel time is worse than none: a unit plans the morning '
     + 'around it');
  ok('  ...and nothing computes one',
     !/travel_estimate\s*=\s*[^;]*\d/.test(APP),
     'we do not know the traffic on Ikorodu Road');
}

console.log('\nParking, catering and transport are asked for and printed');
{
  ['crew_parking', 'catering', 'transport', 'travel_estimate'].forEach(function (f) {
    ok('  ' + f + ' has a default', new RegExp(f + ": ''").test(APP));
  });
  ['pdCrewParking', 'pdCatering', 'pdTransport', 'pdTravelEstimate'].forEach(function (id) {
    ok('  ' + id + ' is saved', new RegExp("g\\('" + id + "'\\)").test(APP));
    ok('  ' + id + ' is on the form', new RegExp("field\\('" + id + "'").test(APP));
  });
  ok('parking prints beside the base camp',
     /\['Crew Parking', pd\.crew_parking\]/.test(APP));
  ok('catering and transport print only when filled',
     /if \(pd\.catering \|\| pd\.transport\)/.test(APP),
     'four more empty rows on every page is a sheet people skim');

  // A placeholder that shows the SHAPE of an answer gets filled in; one
  // that says "enter parking" does not.
  ok('the placeholders are answers, not instructions',
     /20 vehicles, attendant on duty/.test(APP)
     && /breakfast 07:00, lunch 13:00/.test(APP),
     'a Lagos production manager should recognise their own answer in it');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
