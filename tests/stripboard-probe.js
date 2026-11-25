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

console.log('\nThe board itself');
{
  // Asserted by what each document carries, not by where the code sits:
  // the board exists, and the detailed day-by-day still prints the cast,
  // props and description that a board deliberately leaves out.
  ok('the board is added, not swapped in',
     /pdf\.sectionHeader\('The Board'\)/.test(APP)
     && /pdf\.labelledList\('Cast', sc\.cast_required \|\| sc\.cast\)/.test(APP)
     && /pdf\.labelledList\('Props', sc\.props\)/.test(APP)
     && /if \(sc\.description\) pdf\.body\(sc\.description, 34, 130\);/.test(APP),
     'professional practice has two documents — the board and the detailed '
     + 'day-by-day — and compressing the second into the first throws away '
     + 'the cast, props and description a department reads the night before');
  ok('it is printed once', (APP.match(/sectionHeader\('The Board'\)/g) || []).length === 1);
  ok('a day is marked with a separator row',
     /if \(row && row\.sep\) \{/.test(APP) && /slateBoardRows\.push\(\{ sep:/.test(APP),
     'a board with no day breaks is one continuous list with no shape');
  ok('  ...drawn where the page break is already owned',
     /if \(row && row\.sep\) \{[\s\S]{0,200}check\(12\);/.test(APP));
}

console.log('\nA strip column is a colour, not a word');
{
  // This cost three renders. The strip column holds 'INT|D' and is 6mm
  // wide, so measuring it as text asked how many lines that takes in a
  // 2mm column. The answer is six, every row came out 31mm tall, and the
  // board ran eleven pages for 86 scenes at seven scenes a page.
  //
  // No assertion could have seen it and the text extracted from the PDF
  // looked perfect. It was found by measuring the Y positions of the
  // rendered rows.
  ok('a strip column is not measured as text',
     /if \(c\.strip\) return 1;/.test(APP),
     'measuring "INT|D" in a 2mm column reports six lines and triples '
     + 'every row on the board');
  ok('  ...and is drawn the height of its row',
     /doc\.rect\(cx, y - 3, 3, rowH - 1\.5, 'FD'\)/.test(APP),
     'a run of nights has to read as a band, not a row of dots');
  ok('  ...outlined even when filled, as on the detailed rows',
     /doc\.rect\(cx, y - 3, 3, rowH - 1\.5, 'D'\)/.test(APP));
}

console.log('\nThe columns are sized by measurement, not by eye');
{
  ok('D/N fits EVENING',
     /\{ label: 'D\/N', width: 20 \}/.test(APP),
     'EVENING is 14.2mm at 9pt helvetica and needs 18.2 with padding; at '
     + '14 it broke as "EVENI / NG" and at 18 as "EVENIN / G"');
  ok('  ...and a longer word is abbreviated rather than broken',
     /return c\.length > 8 \? c\.slice\(0, 4\) \+ '\.' : c;/.test(APP),
     'CONTINUOUS is 21.3mm and would break mid-word as "CONTINUOU / S"');
  ok('  ...leaving the standard codes untouched',
     'DAWN'.length <= 8 && 'DUSK'.length <= 8 && 'EVENING'.length <= 8);

  // 6 + 16 + 12 + 20 + 56 + 18 + 12 + 40
  const widths = (APP.match(/width: (\d+)(?=[,}])/g) || []);
  ok('the board columns total the table width',
     /width: 6, strip: true/.test(APP) && /\{ label: 'Set', width: 56 \}/.test(APP),
     'table() draws a 180mm rule under every row, so columns that do not '
     + 'sum to 180 leave a column hanging over the edge of it');
}

console.log('\nCast numbers agree with the breakdown');
{
  ok('they come from the character breakdown, not from a new count',
     /slateBreakdown && slateBreakdown\.character_breakdown/.test(APP)
     && /slateCastNo\[k\] = c\.cast_number;/.test(APP),
     'a board numbering the cast its own way would have an AD calling the '
     + 'wrong actor off the wrong document');
  ok('  ...keyed the same way the merge canonicalises a name',
     /slateCastNo\[slateCastKey\(n\)\]/.test(APP),
     'ADUKE and Aduke are one actor, and VOICE OF ADUKE is the same one '
     + 'again');
  ok('  ...de-duplicated and in order',
     /if \(no && nums\.indexOf\(no\) === -1\) nums\.push\(no\);/.test(APP)
     && /nums\.sort\(function \(a, b\) \{ return a - b; \}\)/.test(APP),
     '"3, 1, 3" is not a cast list');
  ok('an empty column is explained',
     /A blank Cast column means the script names nobody in that scene/.test(APP));
}

console.log('\nEvery page of the board carries its own key');
{
  // Elizabeth put page 1 beside page 4 of the same board. Page 1 has the
  // colour key and says what the document is for; page 4 has neither, and
  // leaves a filmmaker holding "0 3/8" and "1, 3, 4" with no way to decode
  // either. She was right that one teaches and the other intimidates.
  //
  // Same fault as a story day that does not survive a page break, fixed on
  // Report 5 the night before and not then looked for anywhere else.
  ok('table takes a key', /function table\(cols, rows, key\)/.test(APP));
  ok('  ...printed inside header(), so it repeats after every break',
     /function header\(\)[\s\S]{0,900}if \(key\) \{/.test(APP),
     'printed once before the loop it would appear on the first page only, '
     + 'which is the bug');
  ok('  ...and wraps rather than running off the page',
     /doc\.splitTextToSize\(key, 180\)/.test(APP));
  ok('the board passes one', /slateBoardRows,\n\s*'Pages are in eighths/.test(APP));

  // The four things on that page a first-time filmmaker cannot decode.
  ok('it explains eighths', /0 3\/8 is three eighths of a script page/.test(APP),
     'the deepest jargon on the document: nobody who has not been on a '
     + 'scheduled set knows a page is divided into eight');
  ok('it explains the cast numbers',
     /Cast numbers are the ones in Report 2/.test(APP));
  ok('it explains a montage part',
     /"4 pt 3" is part 3 of a montage/.test(APP));
  ok('it repeats the colours in words',
     /Colour: white INT day, yellow EXT day, blue INT night/.test(APP),
     'the swatch legend is on the first page of the schedule and gone by '
     + 'the third');

  ok('the other tables are unchanged',
     /pdf\.table\(\n?\s*\[\{ label: 'Story Day'/.test(APP)
     || /\[\{ label: 'Story Day', width: 32, bold: true, carry: true \}/.test(APP),
     'Report 5 passes no key and must still render');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
