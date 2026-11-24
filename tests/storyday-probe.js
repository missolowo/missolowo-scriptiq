// The story day: read once, displayed everywhere.
//
//   node tests/storyday-probe.js
//
// WHY THIS FILE EXISTS
//
// `story_day` was asked of the model on every run from the beginning. The
// prompt says it in as many words — "A story day, e.g. (DAY 1), goes in
// story_day" — the model answered, and the value was scrubbed of stray
// characters at merge time and then read by NOTHING: no renderer, no PDF,
// no schedule row, no call sheet. One grep for the field name across the
// whole product returned the prompt that asks for it, the schema that
// shapes it, and a list of fields to clean. Nothing else.
//
// That is the worst shape a bug can have, because it is invisible from
// both ends. The model was paid for the field, so a token audit shows it
// working. The field was present in the data, so a schema audit shows it
// working. Only a wardrobe supervisor asking "which of these scenes match"
// would have found it, and by then they are on set.
//
// What it cost: story day is the ONLY continuity key on a breakdown.
// Scenes 12 and 48 may shoot three weeks apart and still be the same
// story morning, so they need the same costume, the same hair and the same
// state of injury. A document that cannot say which scenes those are
// cannot be the document a production works from.
//
// WHAT IS ASSERTED HERE
//
// 1. The reader itself — every shape the model actually returns.
// 2. That a bare time of day is never mistaken for a story day. This is
//    the model's real failure mode: asked for the story day of a scene
//    whose heading says DAY, it answers "DAY".
// 3. That there is exactly ONE reader. A second one in schedule.js and a
//    third in callsheet.js is the duplicate source of truth that produced
//    every other bug of this evening, so the functions are asserted to
//    pass the field through and never interpret it.
// 4. That the field reaches all three documents.
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const SCHED = fs.readFileSync(__p.join(ROOT, 'netlify/functions/schedule.js'), 'utf8');
const CS = fs.readFileSync(__p.join(ROOT, 'netlify/functions/callsheet.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(src, needle) {
  const s = src.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  return src.slice(s, end);
}

const slateStoryDay = new Function(
  block(APP, 'function slateStoryDay') + '; return slateStoryDay;')();

// ══════════════════════════════════════════════════
console.log('\nNothing in, nothing out');
{
  [undefined, null, '', '   ', 'null', 'undefined', 'N/A', 'n/a', 'TBD'].forEach(function (v) {
    ok('  ' + JSON.stringify(v) + ' gives no story day', slateStoryDay(v) === '',
       JSON.stringify(slateStoryDay(v))
       + ' — an invented story day tells wardrobe two scenes match when they do not');
  });
}

// ══════════════════════════════════════════════════
// THE MODEL'S REAL MISTAKE.
console.log('\nA time of day is NOT a story day');
{
  // Asked for the story day of a scene whose heading reads
  // "INT. WORKSHOP — DAY", the model answers "DAY". Printed as a story
  // day that would make every daylight scene in the film match every
  // other daylight scene — which is the opposite of continuity.
  ['DAY', 'day', 'Day', '(DAY)', 'NIGHT', 'Night', 'MORNING', 'AFTERNOON',
   'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME'
  ].forEach(function (v) {
    ok('  "' + v + '" is rejected', slateStoryDay(v) === '',
       JSON.stringify(slateStoryDay(v))
       + ' — every daylight scene in the film would read as one story day');
  });
}

// ══════════════════════════════════════════════════
console.log('\nThe number is the story day, however it was written');
{
  const same = [
    ['1', '1'], ['DAY 1', '1'], ['(DAY 1)', '1'], ['Day 1', '1'],
    ['day 1', '1'], ['D1', '1'], ['STORY DAY 1', '1'], ['Story Day 1', '1'],
    ['  (DAY 1)  ', '1'], ['DAY 12', '12'], ['NIGHT 2', '2']
  ];
  same.forEach(function (pair) {
    ok('  "' + pair[0] + '" reads as ' + pair[1], slateStoryDay(pair[0]) === pair[1],
       JSON.stringify(slateStoryDay(pair[0])));
  });

  // The point of normalising at all: these must come out EQUAL, because a
  // breakdown where scene 12 says "DAY 1" and scene 48 says "(Day 1)" has
  // told nobody that they match.
  ok('two spellings of one story day match',
     slateStoryDay('DAY 1') === slateStoryDay('(Day 1)')
     && slateStoryDay('1') === slateStoryDay('Story Day 1'),
     'wardrobe cannot group scenes that do not compare equal');
}

console.log('\nA range stays a range');
{
  // A scene the writer spread over two story days is a fact a production
  // needs, not an untidiness to round off.
  ['DAY 2-3', 'DAY 2–3', 'Day 2 to 3', '2-3'].forEach(function (v) {
    ok('  "' + v + '" keeps both ends', slateStoryDay(v) === '2–3',
       JSON.stringify(slateStoryDay(v)));
  });
}

console.log('\nA writer’s own grouping is kept, not discarded');
{
  // No number, but meaningful. "Wedding day" groups scenes exactly as a
  // numeral would, and throwing it away for not being a digit would lose
  // the only continuity key the script gave.
  ok('"Wedding day" survives', slateStoryDay('Wedding day') === 'Wedding day');
  ok('"Flashback" survives', slateStoryDay('Flashback') === 'Flashback');
  ok('  ...and keeps the script’s own capitalisation',
     slateStoryDay('Wedding day') !== 'WEDDING DAY',
     'the value is displayed, so it is not shouted');
}

console.log('\nReading twice gives the same answer');
{
  // This matters for productions saved BEFORE the normaliser existed: the
  // renderers read the field again, so an old un-normalised value is fixed
  // on display, and a new already-normalised one is left alone.
  ['', '1', '2–3', 'Wedding day', 'DAY 1', '(DAY 7)', 'DAY'].forEach(function (v) {
    const once = slateStoryDay(v);
    ok('  ' + JSON.stringify(v) + ' is stable under a second read',
       slateStoryDay(once) === once,
       JSON.stringify(once) + ' then ' + JSON.stringify(slateStoryDay(once)));
  });
}

// ══════════════════════════════════════════════════
// ONE READER, NOT THREE.
console.log('\nThere is exactly one reader, and it is at the boundary');
{
  // The open paren matters: slateStoryDayProvenance shares the prefix, and
  // a loose pattern reported two readers where there is one. An assertion
  // that cries wolf is one the next person turns off.
  ok('app.html defines slateStoryDay once',
     (APP.match(/function slateStoryDay\(/g) || []).length === 1,
     (APP.match(/function slateStoryDay\(/g) || []).length + ' definitions');

  ok('the merge normalises the field where the model’s answer arrives',
     /scene\.story_day\s*=\s*slateStoryDay\(scene\.story_day\)/.test(APP),
     'without this, every renderer has to interpret the raw value and they '
     + 'will eventually disagree');

  // The functions must PASS IT THROUGH. A reader of their own is the
  // duplicate source of truth that caused the scene-number, location,
  // montage and span bugs — all four were two places deciding one thing.
  ok('schedule.js never interprets a story day',
     !/function slateStoryDay/.test(SCHED) && !/story_day.*match\(/.test(SCHED),
     'a second opinion on continuity is worse than none');
  ok('callsheet.js never interprets a story day',
     !/function slateStoryDay/.test(CS) && !/story_day.*match\(/.test(CS),
     'a second opinion on continuity is worse than none');
}

// ══════════════════════════════════════════════════
console.log('\nThe field reaches all three documents');
{
  // The schedule.
  ok('the schedule carries it on the scene',
     /sd:\s*s\.story_day/.test(SCHED) && /story_day:\s*s\.sd/.test(SCHED),
     'it has to survive slimScenes, which is where every other dropped '
     + 'field was dropped');
  ok('  ...and on the shoot day, as the set of story days it covers',
     /story_days:/.test(SCHED),
     'a day built by location spans several story days, and that is exactly '
     + 'when wardrobe needs warning');
  ok('  ...and on scenes the screenplay never placed',
     /story_day:\s*s\.sd\s*\|\|\s*''/.test(SCHED));

  // The call sheet.
  ok('the call sheet carries it on the scene',
     /story_day:\s*s\.story_day/.test(CS));
  ok('  ...and on the advance schedule for tomorrow',
     /story_day:\s*sc\.story_day/.test(CS),
     'the crew reads the advance to know what to prepare');

  // The documents themselves. Four renderers print a scene, and a field on
  // three of them is a field a crew learns not to trust.
  const printed = [
    ['breakdown PDF',    /Story Day '\s*\+\s*bdSd/],
    ['schedule PDF',     /SD '\s*\+\s*schSd/],
    ['call sheet PDF',   /SD '\s*\+\s*csSd/],
    ['breakdown screen', /slateStoryDay\(s\.story_day\)/],
    ['call sheet screen', /SD '\s*\+\s*slateEscapeHtml\(sdText\)/]
  ];
  printed.forEach(function (pair) {
    ok('  printed on the ' + pair[0], pair[1].test(APP),
       'the field exists and this document still does not show it');
  });

  ok('the schedule day header states its story days',
     /Story day'\s*\+\s*\(slateDaySd\.length/.test(APP));
  ok('the call sheet says so when a day spans more than one',
     /This day covers story days/.test(APP)
     && /csSds\.length\s*>\s*1/.test(APP),
     'and only then — a sheet that annotates the ordinary case teaches a '
     + 'crew to skip its annotations');
}

console.log('\nWhat is displayed is escaped');
{
  // The value comes from the model, which means it comes from the script,
  // which means it is data. Both screen renderers interpolate it into HTML.
  ok('the breakdown chip escapes it',
     /slateEscapeHtml\(slateStoryDay\(s\.story_day\)\)/.test(APP));
  ok('the call sheet row escapes it',
     /slateEscapeHtml\(sdText\)/.test(APP));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
