// The strip-board colour on the shooting schedule.
//
//   node tests/stripboard-probe.js
//
// WHY THIS FILE EXISTS
//
// An AD reads a board faster than a table, and the reason is colour: the
// shape of a day is visible from across a room without reading a word.
// The convention a production board has used for decades is
//
//   INT / DAY    white
//   EXT / DAY    yellow
//   INT / NIGHT  blue
//   EXT / NIGHT  green
//
// and it is only worth anything if it is the one a crew already knows.
// Inventing a fifth meaning, or quietly colouring a dusk scene as night,
// makes a lighting decision by accident on a document a gaffer reads.
//
// The standard has NO colour for dawn or dusk — the scheduling tools each
// invented their own — so Slate leaves those unfilled rather than
// rounding them. "I do not know" is a first-class answer here as well.
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
function stmt(n) { const s = APP.indexOf(n); return APP.slice(s, APP.indexOf('};', s) + 2); }

// stripKey reads the time of day through slateDayNightCode, so both come
// from the file rather than a copy of either.
const api = new Function(
  block('function slateDayNightCode') + '\n'
  + stmt('var SLATE_STRIP = {') + '\n'
  + block('function stripKey') + '\n'
  + '; return { key: stripKey, strip: SLATE_STRIP };')();

console.log('\nThe four colours are the convention, not ours');
{
  const S = api.strip;
  ok('INT / DAY is white',       JSON.stringify(S['INT|D']) === '[255,255,255]', JSON.stringify(S['INT|D']));
  ok('EXT / DAY is yellow',      S['EXT|D'][0] > 220 && S['EXT|D'][1] > 180 && S['EXT|D'][2] < 140,
     JSON.stringify(S['EXT|D']));
  ok('INT / NIGHT is blue',      S['INT|N'][2] > S['INT|N'][0] && S['INT|N'][2] > S['INT|N'][1],
     JSON.stringify(S['INT|N']));
  ok('EXT / NIGHT is green',     S['EXT|N'][1] > S['EXT|N'][0] && S['EXT|N'][1] > S['EXT|N'][2],
     JSON.stringify(S['EXT|N']));
  ok('there are exactly four',   Object.keys(S).length === 4, Object.keys(S).join(', ')
     + ' — a fifth colour is a meaning a crew has to be taught');
}

console.log('\nIt reads INT/EXT and day/night off the scene');
{
  ok('INT + DAY',        api.key('INT', 'DAY') === 'INT|D');
  ok('EXT + MORNING',    api.key('EXT', 'MORNING') === 'EXT|D',
     'morning and afternoon are day on a board');
  ok('EXT + AFTERNOON',  api.key('EXT', 'AFTERNOON') === 'EXT|D');
  ok('INT + NIGHT',      api.key('INT', 'NIGHT') === 'INT|N');
  ok('EXT + NIGHT',      api.key('EXT', 'NIGHT') === 'EXT|N');
  ok('lower case is the same scene',
     api.key('int', 'night') === 'INT|N' && api.key(' Ext ', ' Day ') === 'EXT|D');
}

console.log('\nWhat has no standard colour gets none');
{
  ok('DUSK is unfilled',    api.key('EXT', 'DUSK') === '',
     'the standard has no dusk colour, and calling it night is a lighting '
     + 'decision made by accident');
  ok('SUNSET is unfilled',  api.key('EXT', 'SUNSET') === '');
  ok('SUNDOWN is unfilled', api.key('EXT', 'SUNDOWN') === '',
     'THE HILLS BETWEEN US writes five scenes this way');
  ok('DAWN is unfilled',    api.key('EXT', 'DAWN') === '');
  ok('a time the script wrote in its own words is unfilled',
     api.key('EXT', 'ONE YEAR PASSING') === '' && api.key('INT', 'CONTINUOUS') === '');
  ok('no time of day at all is unfilled',
     api.key('INT', '') === '' && api.key('INT', null) === '');
}

console.log('\nA heading that is neither INT nor EXT is neither colour');
{
  ok('INT/EXT belongs to no column', api.key('INT/EXT', 'DAY') === '',
     'the script said both, so the board says neither rather than picking');
  ok('I/E likewise',                 api.key('I/E', 'DAY') === '');
  ok('a montage with no INT or EXT',  api.key(null, 'DAY') === '' && api.key('', 'DAY') === '');
  ok('a dash',                        api.key('\u2014', 'DAY') === '');
}

console.log('\nNothing it is handed makes it throw');
{
  [[undefined, undefined], [null, null], [{}, {}], [5, 5], [[], []]
  ].forEach(function (pair, i) {
    let threw = '';
    try { api.key(pair[0], pair[1]); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' is survivable', !threw, threw);
  });
}

// ══════════════════════════════════════════════════
console.log('\nHow it is drawn');
{
  const bar = block('function stripBar');
  ok('every bar is outlined, filled or not',
     /'FD'/.test(bar) && /'D'/.test(bar),
     'white is one of the four states, and a white fill on white paper is '
     + 'nothing at all');
  ok('the bar is drawn in the left margin',
     /doc\.rect\(11, /.test(bar),
     'at x=11 nothing moves and no row grows, so a layout that was already '
     + 'verified cannot be changed by a colour');
  ok('  ...and is tall enough to read as a strip',
     /2\.6, 12,/.test(bar),
     'the first version was 8mm on a 19mm row and read as a tick beside the '
     + 'scene number rather than a band down the page');
  ok('it is drawn before the scene numeral',
     /pdf\.stripBar\(sc\.int_ext, sc\.time_of_day\);[\s\S]{0,80}pdf\.sceneNumeral/.test(APP),
     'sceneNumeral does not advance y, so a bar drawn after it would sit '
     + 'beside the wrong row');
}

console.log('\nNothing depends on the colour alone');
{
  ok('the time of day is printed on every row',
     /slateDayNightCode\(sc\.time_of_day\)/.test(APP),
     'a mono printer, a photocopy and a colour-blind reader all have to get '
     + 'the same schedule');
  ok('INT or EXT is printed on every row',
     /\(sc\.int_ext \|\| '\\u2014'\) \+ ' \\u00b7 '/.test(APP));
}

console.log('\nThe key is on the document');
{
  ok('a legend exists', /function stripLegend/.test(APP));
  ok('  ...naming all four', /INT \/ DAY/.test(APP) && /EXT \/ DAY/.test(APP)
     && /INT \/ NIGHT/.test(APP) && /EXT \/ NIGHT/.test(APP));
  ok('  ...and saying why dawn and dusk are blank',
     /Dawn and dusk have no standard colour and are left unfilled/.test(APP),
     'a blank strip with no explanation reads as a bug');
  ok('it is printed once per schedule, not once per day',
     (APP.match(/pdf\.stripLegend\(\)/g) || []).length === 1,
     (APP.match(/pdf\.stripLegend\(\)/g) || []).length + ' call sites');
  ok('the board is on the schedule only',
     (APP.match(/pdf\.stripBar\(/g) || []).length === 1,
     'the breakdown is read in script order and is not a board');
}

console.log('\nThe day header does not print a separator for a date it has not got');
{
  ok('the date carries its own separator',
     /\(day\.date \? '  \\u00b7  ' \+ day\.date : ''\)/.test(APP)
     || /\(day\.date \? '  · ' \+ day\.date : ''\)/.test(APP)
     || /\(day\.date \? '  ·  ' \+ day\.date : ''\)/.test(APP),
     'an unboarded schedule printed "Day 01 of 15  ·    ·  IMOLE HILLS", '
     + 'and every schedule is unboarded before a start date is set');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
