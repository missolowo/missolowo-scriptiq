// Which scenes have to match each other.
//
//   node tests/continuity-probe.js
//
// WHY THIS FILE EXISTS
//
// This is the one thing a breakdown can tell a script supervisor that
// reading the script in order cannot: scenes 12 and 48 may shoot three
// weeks apart and still be the same story morning, so the costume, the
// hair and the state of an injury have to agree across them. A schedule
// ordered by location scatters a story day deliberately, which is correct
// for the budget and invisible to continuity.
//
// Stage 1 is deterministic and free. Every value was already read and paid
// for; this is a grouping over it, with no model call and no credit. The
// pass that looks for actual contradictions is separate and built on top
// of these groups, and this must render without it.
//
// WHAT THIS PROBE IS REALLY GUARDING
//
// The failure mode of a continuity report is not missing a contradiction.
// It is crying wolf. A script supervisor who chases two findings that turn
// out to be nothing stops reading the report, and then it is worse than
// having none — so most of the assertions below are about what must NOT be
// reported: a scene with nothing to match, a story day the model never
// gave, an absence dressed up as a change.
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
  let depth = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}

const api = new Function(
  block('function slateStoryDay') + '\n'
  + block('function slateContinuityGroups') + '\n'
  + block('function slateDayOfScene') + '\n'
  + '; return { groups: slateContinuityGroups, dayOf: slateDayOfScene };')();
const { groups, dayOf } = api;

// A scene as the merge leaves one.
function sc(idx, storyDay, extra) {
  return Object.assign({
    scene_index: idx, scene_number: String(idx), story_day: storyDay,
    int_ext: 'INT', time_of_day: 'DAY', location: 'Workshop', set: 'Workshop',
    cast: ['TOLANI'], costume: [], makeup_hair: [], props: []
  }, extra || {});
}

// ══════════════════════════════════════════════════
console.log('\nScenes sharing a story day are grouped');
{
  const g = groups([
    sc(1, 'DAY 1', { costume: ['torn school shirt'] }),
    sc(2, 'DAY 2'),
    sc(3, '(Day 1)', { costume: ['clean white blouse'] }),
    sc(4, 'DAY 2')
  ], null);

  ok('two groups, not four', g.length === 2, g.length + '');
  ok('  ...and two spellings of one day are ONE group',
     g[0].story_day === '1' && g[0].scenes.length === 2,
     JSON.stringify(g.map(x => [x.story_day, x.scenes.length]))
     + ' — "DAY 1" and "(Day 1)" are the same story morning');
  ok('scenes inside a group are in script order',
     g[0].scenes.map(s => s.scene_index).join(',') === '1,3',
     g[0].scenes.map(s => s.scene_index).join(','));
}

// ══════════════════════════════════════════════════
// WHAT MUST NOT BE REPORTED.
console.log('\nA scene with nothing to match is not reported');
{
  // One scene alone on its story day has nothing to agree with. Reporting
  // it is the first step toward a report nobody reads.
  const g = groups([sc(1, 'DAY 1', { costume: ['wrapper'] }), sc(2, 'DAY 2')], null);
  ok('a story day with one scene is dropped', g.length === 0,
     JSON.stringify(g.map(x => x.story_day)));
}

console.log('\nScenes the model gave no story day are left out');
{
  // Not collected into a group of their own. "Scenes we cannot place in
  // story time" is a different report for a different reader, and putting
  // them here buries the groups that matter.
  const g = groups([
    sc(1, ''), sc(2, null), sc(3, undefined), sc(4, 'null'), sc(5, 'N/A')
  ], null);
  ok('no group is made from them', g.length === 0,
     JSON.stringify(g.map(x => x.story_day)));

  // And the model's actual mistake: answering the TIME of day when asked
  // for the STORY day. If "DAY" became a story day, every daylight scene
  // in the film would group together and the report would open with a
  // single group of sixty scenes.
  const t = groups([
    sc(1, 'DAY', { costume: ['wrapper'] }),
    sc(2, 'DAY', { costume: ['uniform'] }),
    sc(3, 'NIGHT')
  ], null);
  ok('a time of day never becomes a story day group', t.length === 0,
     JSON.stringify(t.map(x => [x.story_day, x.scenes.length]))
     + ' — this would group every daylight scene in the film as one');
}

// ══════════════════════════════════════════════════
console.log('\nThe expensive case is named: one story day, several shoot days');
{
  const schedule = { schedule: [
    { day: 1, scenes: [{ scene_index: 1 }, { scene_index: 2 }] },
    { day: 9, scenes: [{ scene_index: 3 }] }
  ]};
  const map = dayOf(schedule);
  const g = groups([
    sc(1, '1', { costume: ['torn school shirt'] }),
    sc(2, '2'),
    sc(3, '1', { costume: ['clean white blouse'] })
  ], map);

  ok('the shoot days a story day falls on are listed',
     JSON.stringify(g[0].shoot_days) === '[1,9]', JSON.stringify(g[0].shoot_days));
  ok('  ...and it is marked split', g[0].split === true);
  ok('  ...in ascending order even when the group is not',
     JSON.stringify(groups([sc(3, '1'), sc(1, '1')], map).shoot_days
       || groups([sc(3, '1'), sc(1, '1')], map)[0].shoot_days) === '[1,9]');

  // A story day shot entirely on one day is NOT split. It still needs
  // matching, but it is the cheap case and must not look like the dear one.
  const same = groups([sc(1, '5'), sc(2, '5')],
    dayOf({ schedule: [{ day: 3, scenes: [{ scene_index: 1 }, { scene_index: 2 }] }] }));
  ok('a story day shot in one day is not marked split',
     same[0].split === false && JSON.stringify(same[0].shoot_days) === '[3]',
     JSON.stringify(same[0]. shoot_days) + ' split=' + same[0].split);
}

console.log('\nIt works before a schedule exists');
{
  // The breakdown comes first and the schedule is a separate credit. A
  // filmmaker who has only run a breakdown should still get the grouping.
  const g = groups([
    sc(1, '1', { costume: ['wrapper'] }), sc(2, '1', { costume: ['uniform'] })
  ], null);
  ok('the grouping still happens', g.length === 1);
  ok('  ...with no shoot days claimed',
     JSON.stringify(g[0].shoot_days) === '[]', JSON.stringify(g[0].shoot_days));
  ok('  ...and nothing is called split',
     g[0].split === false,
     'unknown shoot days must not read as "all on one day" OR as split');
  ok('no schedule gives no scene-to-day map', dayOf(null) === null
     && dayOf({}) === null && dayOf({ schedule: 'x' }) === null);
}

console.log('\nHow much of the group the script actually describes');
{
  // A group where nothing is described has nothing to match and is not
  // worth a reader's time. A group where one scene is described and five
  // are not is a question for the writer, not a contradiction.
  const g = groups([
    sc(1, '1', { costume: ['torn school shirt'] }),
    sc(2, '1'),
    sc(3, '1', { makeup_hair: ['bruise over left eye'] })
  ], null);
  ok('described counts scenes carrying costume or makeup',
     g[0].described === 2, g[0].described + ' of 3');
  ok('  ...and a group describing nothing says so rather than being hidden',
     groups([sc(1, '1'), sc(2, '1')], null)[0].described === 0,
     'hidden, a reader cannot tell a clean story day from an unread one');
}

console.log('\nOrder a script supervisor can read');
{
  const g = groups([
    sc(1, 'Wedding day'), sc(2, 'Wedding day'),
    sc(3, '10'), sc(4, '10'),
    sc(5, '2'), sc(6, '2')
  ], null);
  ok('numeric story days are in story order, not string order',
     g.map(x => x.story_day).slice(0, 2).join(',') === '2,10',
     g.map(x => x.story_day).join(',') + ' — a string sort puts 10 before 2');
  ok('  ...and a day the writer named in words comes after them',
     g[g.length - 1].story_day === 'Wedding day',
     g.map(x => x.story_day).join(','));
}

console.log('\nNothing it is given can make it throw');
{
  [undefined, null, [], [null], [undefined], [{}], [{ story_day: '1' }],
   [{ story_day: '1' }, { story_day: '1' }]
  ].forEach(function (input, i) {
    let threw = '';
    try { groups(input, null); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' does not throw', !threw, threw);
  });
  // A scene with no scene_index must not reorder the group wrongly or crash.
  let threw = '';
  try {
    groups([{ story_day: '1', costume: [] }, { story_day: '1', costume: [] }], null);
  } catch (e) { threw = e.message; }
  ok('scenes with no index still group', !threw, threw);
}

// ══════════════════════════════════════════════════
console.log('\nIt reaches both documents, and costs nothing');
{
  ok('the breakdown screen renders it',
     /Report 5 — Continuity by Story Day<\/div>/.test(APP));
  ok('the breakdown PDF renders it',
     /pdf\.sectionHeader\('Report 5 — Continuity by Story Day'\)/.test(APP));
  // The property, not the spelling. The PDF holds the day map in a variable
  // because its table needs the per-scene day as well, so an assertion that
  // demanded two byte-identical call sites failed on a correct change.
  // What must be true is that BOTH renderers group through the one function
  // and derive their shoot days from the one schedule reader — two
  // renderers grouping separately is the duplicate source of truth that
  // every bug of 23 November came from.
  ok('both renderers group through the one function',
     (APP.match(/slateContinuityGroups\(/g) || []).length === 3,
     (APP.match(/slateContinuityGroups\(/g) || []).length
       + ' call sites (expected 3: the definition and two renderers)');
  ok('  ...and both take their shoot days from the one schedule reader',
     (APP.match(/slateDayOfScene\(slateSchedule\)/g) || []).length === 2,
     (APP.match(/slateDayOfScene\(slateSchedule\)/g) || []).length + ' of 2');

  // Free. Every value was already read and paid for, so this must not
  // charge a credit or call the model.
  const screen = APP.slice(APP.indexOf('Report 5 — Continuity by Story Day'),
                           APP.indexOf('if (streaming && !streaming.complete) {'));
  ok('no credit is charged for it',
     !/slateChargeCredit|credits_remaining\s*-/.test(screen));
  ok('no model call is made for it',
     !/fetch\(/.test(screen),
     'stage 1 is a grouping over data we already hold');

  // Mid-stream a story day looks split only because the scenes that
  // complete it have not arrived, and a report that cries wolf while the
  // user watches it is worse than one that appears a moment later.
  ok('it waits until the whole script is read',
     /if \(!streaming \|\| streaming\.complete\) \{\s*\n\s*var slateCont/.test(APP),
     'a half-read script makes every story day look split');

  // ── The PDF draws it as a TABLE, and that is not a style choice ──
  //
  // The first version used pdf.labelledList and the PDF came back with the
  // group heading printed THROUGH the scenes it was labelling: labelledList
  // draws its label at x and the values at x+26, so any label longer than
  // 26mm overruns the column. "Story day 1 · 4 scenes · 2 described · shot
  // across days 1, 9" is four times that.
  //
  // Found by rendering the PDF and looking at it. Every assertion here
  // passed while it was broken, and the SCREEN version of the same data was
  // perfectly fine — which is exactly why a layout cannot be signed off
  // from assertions alone.
  ok('the PDF draws the report as a table, not a labelled list',
     /pdf\.table\(\s*\n?\s*\[\{ label: 'Story Day'/.test(APP),
     'a long label in a labelledList prints through the column it labels');
  ok('  ...with the shoot day in its own column',
     /label: 'Shoot Day'/.test(APP),
     'a story day reading 1, 1, 9, 9 down that column IS the split, shown '
     + 'rather than announced');
  ok('  ...and the groups with nothing described said once, after it',
     /slateContBare/.test(APP),
     'a note between every pair of rows is how a table becomes unreadable');

  // Nothing here is a fault, and saying so is what stops it being read as
  // an error list.
  ok('it says plainly that nothing in it is a fault',
     (APP.match(/it is what/g) || []).length >= 2,
     'a continuity sheet read as an error list is a continuity sheet '
     + 'nobody reads twice');
}

console.log('\nA story day that outlives the page still says which day it is');
{
  // THE HILLS BETWEEN US puts 32 scenes on story day 1. The group names
  // itself on its first row only — right, because a heading in a table
  // collides with the rows it heads — so pages two and three of that group
  // had an empty Story Day column on every row. A script supervisor turning
  // the page saw scene numbers with nothing saying what they have to match.
  //
  // Found by rendering a real feature-length breakdown and reading it. The
  // six-scene fixture the renderers had always been driven with cannot
  // produce a group that spans a page, which is why no assertion saw this.
  ok('the Story Day column is marked to carry',
     /\{ label: 'Story Day', width: 32, bold: true, carry: true \}/.test(APP));
  ok('  ...and the table carries it only after a page break',
     /else if \(broke && carried\[i\]\) val = carried\[i\] \+ '  \(cont\.\)';/.test(APP),
     'repeating it on every row would undo the grouping the blank column '
     + 'exists to create');
  ok('  ...marked as a continuation, not a second group',
     /\(cont\.\)/.test(APP),
     'a bare repeated "1" reads as story day 1 starting again');
  ok('  ...carrying the name only, not the count in brackets',
     /carried\[i\] = val\.split\('  \('\)\[0\]/.test(APP),
     'the count belongs to the whole group, not the part of it on this '
     + 'page — and a short label cannot wrap and change the row height '
     + 'already measured');
  ok('the break is recorded where the break is decided',
     /if \(y \+ rowH > 278\) \{ newPage\(\); header\(\); broke = true; \}/.test(APP),
     'any other place would be guessing where the page ended');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
