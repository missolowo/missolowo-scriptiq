// How a shoot day is built.
//
//   node tests/packer-probe.js
//
// WHY THIS FILE EXISTS
//
// slateAssignDays decides what a filmmaker shoots on which day, and until
// 24 November it measured a day in SCENES. perDay was
// ceil(totalScenes / dayCount), so nine half-page scenes and nine
// three-page scenes were the same day. Eighths were computed per scene,
// stored, printed on the schedule — and played no part in the decision.
// No AD schedules that way: a day is four to five pages, fewer on a night
// exterior.
//
// The second defect was quieter. The grouping separated `location|D` from
// `location|N` correctly, and then the piece splitter built
// `{location, scenes}` and dropped the night flag, so the packer put day
// work and night work on the same day. Nothing ordered the scenes inside
// a day either — they sat in push order, so a day could print night scene
// 3, day scene 40, night scene 7.
//
// WHAT THIS PROBE GUARDS, IN ORDER OF HOW BADLY IT WOULD HURT
//
// 1. CONSERVATION. Every scene on exactly one day, exactly once. A
//    schedule quietly missing a scene is the worst thing this product can
//    produce, because nobody goes looking and the scene surfaces on a
//    morning nobody planned for it.
// 2. dayCount is never exceeded. A filmmaker asked for 20 days.
// 3. The page budget is actually used.
// 4. Lighting is not mixed while there are days left to open.
// 5. Each day runs dawn, day, dusk, night.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const { slateAssignDays, slateAddUnplacedToDays } = require(__p.join(ROOT, 'netlify/functions/schedule.js'));

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// A scene as slimScenes leaves one.
let __i = 0;
function sc(loc, tod, eighths) {
  __i++;
  return { idx: __i, n: String(__i), label: String(__i), loc: loc, tod: tod,
           ie: 'INT', eighths: eighths, cast: [], bg: '', sd: '' };
}
function reset() { __i = 0; }

const all = (days) => days.reduce((a, d) => a.concat(d.scenes), []);
const pages = (d) => d.scenes.reduce((a, s) => a + (Number(s.eighths) || 8), 0) / 8;

// ══════════════════════════════════════════════════
// 1. CONSERVATION — the one that must never fail.
console.log('\nEvery scene lands on exactly one day');
{
  const shapes = {
    'one location, even scenes': () => Array.from({ length: 12 }, () => sc('Workshop', 'DAY', 8)),
    'many locations, one scene each': () =>
      Array.from({ length: 17 }, (_, i) => sc('Place ' + i, 'DAY', 8)),
    'one enormous scene': () => [sc('Workshop', 'DAY', 96)],
    'scenes with no eighths at all': () =>
      Array.from({ length: 9 }, () => sc('Workshop', 'DAY', 0)),
    'mixed day and night, same location': () =>
      [sc('Workshop', 'DAY', 8), sc('Workshop', 'NIGHT', 8), sc('Workshop', 'DAY', 8),
       sc('Workshop', 'NIGHT', 8)],
    'no location at all': () => Array.from({ length: 6 }, () => sc('', 'DAY', 8)),
    'a single scene': () => [sc('Workshop', 'DAY', 8)]
  };

  Object.keys(shapes).forEach(function (name) {
    [1, 2, 3, 7, 20].forEach(function (dayCount) {
      reset();
      const scenes = shapes[name]();
      const days = slateAssignDays(scenes, dayCount);
      const out = all(days);
      const ids = out.map(s => s.idx).sort((a, b) => a - b);
      const want = scenes.map(s => s.idx).sort((a, b) => a - b);
      const once = new Set(ids).size === ids.length;
      ok('  ' + name + ', ' + dayCount + ' day(s)',
         JSON.stringify(ids) === JSON.stringify(want) && once,
         out.length + ' of ' + scenes.length
         + (once ? '' : ' — A SCENE IS ON TWO DAYS'));
    });
  });
}

console.log('\nThe filmmaker’s day count is never exceeded');
{
  [1, 2, 3, 5, 20].forEach(function (dayCount) {
    reset();
    const scenes = Array.from({ length: 40 }, (_, i) => sc('Place ' + (i % 9), 'DAY', 8));
    const days = slateAssignDays(scenes, dayCount);
    ok('  asked for ' + dayCount + ', got ' + days.length, days.length <= dayCount,
       'a filmmaker who asked for ' + dayCount + ' days cannot be handed ' + days.length);
  });
}

// ══════════════════════════════════════════════════
// 3. THE PAGE BUDGET IS USED.
console.log('\nA day is built to pages, not to a scene count');
{
  // The case that proves it. Six scenes: three of them a page each, three
  // of them four pages each. By scene count over two days this is 3 and 3,
  // which is 3 pages against 12. By pages it must not be.
  reset();
  const scenes = [
    sc('A', 'DAY', 8), sc('A', 'DAY', 8), sc('A', 'DAY', 8),
    sc('B', 'DAY', 32), sc('B', 'DAY', 32), sc('B', 'DAY', 32)
  ];
  const days = slateAssignDays(scenes, 2);
  const spread = days.map(pages);
  ok('the heavy location is split rather than stacked',
     Math.max.apply(null, spread) < 12,
     JSON.stringify(spread) + ' pages — by scene count this was 3 and 12');

  // And a long scene is not treated as cheap because it is one scene.
  reset();
  const heavy = [sc('A', 'DAY', 96), sc('B', 'DAY', 8), sc('C', 'DAY', 8)];
  const d2 = slateAssignDays(heavy, 3);
  const withBig = d2.filter(d => d.scenes.some(s => s.eighths === 96))[0];
  ok('a twelve-page scene does not share its day with everything else',
     withBig && withBig.scenes.length <= 2,
     withBig ? withBig.scenes.length + ' scenes on the twelve-page day' : 'not found');
}

console.log('\nA scene with no eighths is not free');
{
  // If a missing length cost nothing, a day would absorb any number of
  // them and the page budget would mean nothing on exactly the scripts
  // where the reading went wrong. The scene-count ceiling is the backstop.
  reset();
  const scenes = Array.from({ length: 30 }, () => sc('Workshop', 'DAY', 0));
  const days = slateAssignDays(scenes, 5);
  const biggest = Math.max.apply(null, days.map(d => d.scenes.length));
  ok('thirty unmeasured scenes do not all land on one day', biggest < 30, biggest + ' on one day');
  ok('  ...and they are still all scheduled', all(days).length === 30, all(days).length + '');
}

// ══════════════════════════════════════════════════
// 4. LIGHTING.
console.log('\nDay work and night work are not put on one day');
{
  // Four locations, two day and two night, four days available. There is
  // no reason to mix.
  reset();
  const scenes = [
    sc('A', 'DAY', 8), sc('A', 'DAY', 8),
    sc('B', 'NIGHT', 8), sc('B', 'NIGHT', 8),
    sc('C', 'DAY', 8), sc('C', 'DAY', 8),
    sc('D', 'NIGHT', 8), sc('D', 'NIGHT', 8)
  ];
  const days = slateAssignDays(scenes, 4);
  const mixed = days.filter(function (d) {
    const night = d.scenes.map(s => /NIGHT/i.test(s.tod));
    return night.some(Boolean) && night.some(v => !v);
  });
  ok('no day turns its lights round', mixed.length === 0,
     mixed.length + ' mixed day(s) of ' + days.length
     + ' — the grouping separated these and the packer used to recombine them');

  // But conservation wins over purity. One day, both kinds of scene: it
  // must still schedule everything rather than refuse or drop.
  reset();
  const tight = [sc('A', 'DAY', 8), sc('B', 'NIGHT', 8)];
  const one = slateAssignDays(tight, 1);
  ok('with only one day available it mixes rather than losing a scene',
     all(one).length === 2 && one.length === 1,
     all(one).length + ' scenes on ' + one.length + ' day(s)');
}

console.log('\nLight outranks location when a leftover piece is placed');
{
  // Measured, not reasoned. The first version of this change filtered for
  // ROOM before LIGHT, and on a synthetic 78-scene feature that took days
  // mixing day and night work from 2 up to 7 — worse on the very thing
  // P1.2 exists to fix — while improving everything else.
  //
  // The two are not the same kind of cost. Returning to a wrapped location
  // is hours of travel: expensive, sometimes worth paying. Putting day
  // exteriors and night exteriors on one day is not expensive, it is
  // impossible — you cannot shoot daylight after dark, so that day does
  // not get shot as printed.
  //
  // Here the night piece COULD go back to location A, which is already
  // being visited. It must prefer the night day instead.
  reset();
  const scenes = [
    sc('A', 'DAY', 8), sc('A', 'DAY', 8), sc('A', 'DAY', 8),
    sc('B', 'NIGHT', 8), sc('B', 'NIGHT', 8),
    sc('A', 'NIGHT', 8)
  ];
  const days = slateAssignDays(scenes, 2);
  const mixed = days.filter(function (d) {
    const n = d.scenes.map(s => /NIGHT/i.test(s.tod));
    return n.some(Boolean) && n.some(v => !v);
  });
  ok('the night scene at location A joins the night day, not the A day',
     mixed.length === 0,
     JSON.stringify(days.map(d => d.scenes.map(s => s.loc + '/' + s.tod)))
     + ' — travelling back is a cost; relighting is a physical impossibility');
}

console.log('\nThe asked-for day count is delivered when there is work for it');
{
  // The old packer returned 31 days when asked for 36 on a 78-scene
  // feature, and nothing noticed. A filmmaker planning 36 days and handed
  // 31 has five days of crew booked against a schedule that does not use
  // them.
  reset();
  const scenes = Array.from({ length: 78 }, (_, i) =>
    sc('Place ' + (i % 14), i % 4 === 0 ? 'NIGHT' : 'DAY', 8 + (i % 5) * 4));
  [22, 30, 36].forEach(function (dc) {
    const days = slateAssignDays(scenes.map(s => Object.assign({}, s)), dc);
    ok('  asked for ' + dc + ', delivered ' + days.length, days.length === dc,
       'short by ' + (dc - days.length) + ' — crew booked for days the '
       + 'schedule does not use');
  });
}

console.log('\nEach day runs dawn, day, dusk, night');
{
  reset();
  const scenes = [
    sc('A', 'NIGHT', 8), sc('A', 'DAWN', 8), sc('A', 'DUSK', 8), sc('A', 'DAY', 8)
  ];
  const days = slateAssignDays(scenes, 1);
  const order = days[0].scenes.map(s => s.tod);
  ok('the light runs forward through the day',
     JSON.stringify(order) === JSON.stringify(['DAWN', 'DAY', 'DUSK', 'NIGHT']),
     JSON.stringify(order) + ' — a unit shoots dawn while it has it and '
     + 'turns the lights round once');

  // The sort must be STABLE on rank alone, or it undoes the location
  // grouping the whole packer exists for.
  reset();
  const grouped = [
    sc('A', 'DAY', 8), sc('A', 'DAY', 8), sc('B', 'DAY', 8), sc('B', 'DAY', 8)
  ];
  const d = slateAssignDays(grouped, 1);
  const locs = d[0].scenes.map(s => s.loc).join(',');
  ok('scenes at one location stay together within their block',
     locs === 'A,A,B,B', locs + ' — sorting by anything but the light would '
     + 'undo the grouping');
}

// ══════════════════════════════════════════════════
console.log('\nUnplaced scenes still join a day, and still go last');
{
  reset();
  const placed = [sc('A', 'DAY', 8), sc('A', 'DAY', 8)];
  const days = slateAssignDays(placed, 1);
  const orphan = sc('', 'DAY', 8);
  slateAddUnplacedToDays(days, [orphan]);
  ok('it is on a day', all(days).some(s => s.idx === orphan.idx));
  ok('  ...and at the end of it, after the light ordering',
     days[0].scenes[days[0].scenes.length - 1].idx === orphan.idx,
     'a scene the script never placed is a question, so it sits where a '
     + 'reader finishes rather than interrupting the day');
}

console.log('\nNothing it is handed makes it throw');
{
  [[], null, undefined].forEach(function (input, i) {
    let threw = '';
    try { slateAssignDays(input || [], 3); } catch (e) { threw = e.message; }
    ok('  input ' + i + ' is survivable', !threw, threw);
  });
  let threw = '';
  try { slateAssignDays([sc('A', null, null)], 0); } catch (e) { threw = e.message; }
  ok('a zero day count does not throw', !threw, threw);
  reset();
  try { slateAssignDays([{ idx: 1 }], 2); } catch (e) { threw = e.message; }
  ok('a scene with almost no fields does not throw', !threw, threw);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
