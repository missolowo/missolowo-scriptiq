// slateMoveScene — what the workspace sends when a production manager
// moves a scene. Extracted from app.html so this fails if the shipped
// code drifts.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const fs = require('fs');
const APP = fs.readFileSync(APP_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let d = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') d++;
    else if (APP[j] === '}') { d--; if (d === 0) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}
const moveSrc  = block("async function slateMoveScenes");
const staleSrc = block('function slateCallsheetOutOfDate');

function harness(opts) {
  opts = opts || {};
  const sent = [];
  const saved = [];
  const tracked = [];
  const status = { textContent: '', style: {} };
  const deps = {
    getCurrentUser: () => ({ id: 'u1', email: 'a@b.c' }),
    slateBreakdown: { title: 'T', scenes: [] },
    slateCallsheet: opts.callsheet || (opts.hasCallsheet ? { shoot_day: 1, scenes_today: [] } : null),
    slateSchedule: opts.schedule,
    document: { getElementById: (id) => (id === 'wsMoveStatus' ? status : { value: '30 June 2026' }) },
    localStorage: { setItem() {}, getItem: () => null },
    siqTrack: (n, p) => tracked.push({ n, p }),
    renderWorkspaceSchedule: () => {},
    slateSave: async (k, p) => { saved.push(p); },
    window: { slateProductionId: 'prod-A' },
    slateFetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      if (opts.fail) return { ok: false, status: 400, text: async () => JSON.stringify({ error: opts.fail }) };
      return { ok: true, status: 200, text: async () => JSON.stringify(opts.reply) };
    }
  };
  const build = new Function('deps', `
    var getCurrentUser = deps.getCurrentUser, slateBreakdown = deps.slateBreakdown,
        slateCallsheet = deps.slateCallsheet, slateSchedule = deps.slateSchedule,
        document = deps.document, localStorage = deps.localStorage, siqTrack = deps.siqTrack,
        renderWorkspaceSchedule = deps.renderWorkspaceSchedule, slateSave = deps.slateSave,
        window = deps.window, slateFetch = deps.slateFetch;
    ${staleSrc}
    ${moveSrc}
    return { move: slateMoveScenes, read: function () {
      return { schedule: slateSchedule, stale: slateCallsheetOutOfDate() }; } };
  `);
  return Object.assign(build(deps), { sent, saved, tracked, status });
}

const sched = (days) => ({ schedule: days });
const day = (n, scenes, note) => ({ day: n, production_notes: note || '', scenes: scenes.map(i => ({ scene_index: i, scene_number: i })) });

(async () => {
  console.log('\nThe assignment it sends');
  let h = harness({
    schedule: sched([day(1, [1, 2, 3], 'Early start at the compound'), day(2, [4, 5], 'Market day')]),
    reply: sched([day(1, [1, 2]), day(2, [4, 5, 3])])
  });
  await h.move([3], 2);
  ok('one request was sent', h.sent.length === 1, String(h.sent.length));
  const body = h.sent[0] || {};
  ok('it carries a day_assignment', !!body.day_assignment, JSON.stringify(Object.keys(body)));
  ok('EVERY scene is in it, not just the moved one',
     Object.keys(body.day_assignment || {}).sort().join(',') === '1,2,3,4,5',
     JSON.stringify(body.day_assignment));
  ok('the moved scene has its new day', body.day_assignment['3'] === 2, String(body.day_assignment['3']));
  ok('the others keep theirs',
     body.day_assignment['1'] === 1 && body.day_assignment['2'] === 1 && body.day_assignment['4'] === 2,
     JSON.stringify(body.day_assignment));
  ok('the breakdown goes with it', !!body.breakdown);
  ok('shoot_days is NOT sent — the assignment decides the days',
     body.shoot_days === undefined, String(body.shoot_days));

  console.log('\nMoving a scene to the day it is already on');
  h = harness({ schedule: sched([day(1, [1, 2])]), reply: sched([day(1, [1, 2])]) });
  await h.move([1], 1);
  ok('does nothing at all', h.sent.length === 0, String(h.sent.length));

  console.log('\nProduction notes');
  h = harness({
    schedule: sched([day(1, [1, 2, 3], 'Early start at the compound'), day(2, [4, 5], 'Market day')]),
    reply: sched([day(1, [1, 2]), day(2, [4, 5, 3])])
  });
  await h.move([3], 2);
  let after = h.read().schedule.schedule;
  ok('a day whose scenes changed loses its note',
     after[0].production_notes === '', JSON.stringify(after[0].production_notes));
  ok('  ...because a note for the old scenes names the wrong day', true);
  h = harness({
    schedule: sched([day(1, [1, 2], 'Compound all morning'), day(2, [3], 'Market day'), day(3, [4], 'Night work')]),
    reply: sched([day(1, [1, 2]), day(2, []), day(3, [4, 3])])
  });
  await h.move([3], 3);
  after = h.read().schedule.schedule;
  ok('a day that did NOT change keeps its note',
     after[0].production_notes === 'Compound all morning', JSON.stringify(after[0].production_notes));
  ok('the day that gained a scene does not inherit one',
     after[2].production_notes === '', JSON.stringify(after[2].production_notes));

  console.log('\nIs the call sheet still true? (computed, not flagged)');
  // A call sheet for day 1, holding scenes 1 and 2.
  const cs = (shootDay, scenes) => ({ shoot_day: shootDay, scenes_today: scenes.map(i => ({ scene_index: i })) });

  h = harness({ callsheet: cs(1, [1, 2]),
    schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1]), day(2, [3, 2])]) });
  await h.move([2], 2);
  ok('its day lost a scene -> out of date', h.read().stale === true);

  // The precision that stops a production manager learning to ignore us:
  // moving a scene on day 2 says nothing about day 1's call sheet.
  h = harness({ callsheet: cs(1, [1, 2]),
    schedule: sched([day(1, [1, 2]), day(2, [3]), day(3, [4])]),
    reply:    sched([day(1, [1, 2]), day(2, []),  day(3, [4, 3])]) });
  await h.move([3], 3);
  ok('a move on ANOTHER day leaves it alone', h.read().stale === false);

  h = harness({ callsheet: cs(2, [3]),
    schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1]), day(2, [3, 2])]) });
  await h.move([2], 2);
  ok('its day gained a scene -> out of date', h.read().stale === true);

  h = harness({ callsheet: cs(3, [9]),
    schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1]), day(2, [3, 2])]) });
  await h.move([2], 2);
  ok('its day no longer exists -> out of date', h.read().stale === true);

  h = harness({ callsheet: null,
    schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1]), day(2, [3, 2])]) });
  await h.move([2], 2);
  ok('no call sheet at all -> nothing to warn about', h.read().stale === false);

  ok('the PDF export refuses an out-of-date call sheet',
     /slateExportCallsheet[\s\S]{0,700}slateCallsheetOutOfDate\(\)[\s\S]{0,300}return;/.test(APP));
  ok('  ...and says to rebuild rather than just refusing',
     /out of date[\s\S]{0,200}Rebuild it from the new schedule/.test(APP));

  console.log('\nWhen the server refuses');
  const original = sched([day(1, [1, 2]), day(2, [3])]);
  h = harness({ schedule: original, fail: 'These scenes were left out of the assignment: 3.' });
  await h.move([2], 2);
  ok('the schedule on screen is NOT replaced', h.read().schedule === original);
  ok('nothing is saved to the server', h.saved.length === 0, String(h.saved.length));
  ok('the filmmaker is told what went wrong',
     /left out of the assignment/.test(h.status.textContent), h.status.textContent);
  ok('  ...in the error colour', /error/.test(h.status.style.color || ''), h.status.style.color);

  console.log('\nAfter a successful move');
  h = harness({ schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1]), day(2, [3, 2])]) });
  await h.move([2], 2);
  ok('the new schedule is persisted', h.saved.length === 1 && h.saved[0].kind === 'schedule');
  ok('  ...against the right production', h.saved[0].production_id === 'prod-A');
  ok('the move is tracked', h.tracked.some(t => t.n === 'scene_moved'));

  console.log('\nMoving a group — an actor is never in just one scene');
  h = harness({
    schedule: sched([day(1, [1, 2, 3]), day(2, [4])]),
    reply: sched([day(1, [2]), day(2, [4, 1, 3])])
  });
  await h.move([1, 3], 2);
  let a = (h.sent[0] || {}).day_assignment || {};
  ok('both scenes get the new day', a['1'] === 2 && a['3'] === 2, JSON.stringify(a));
  ok('  ...and the one left behind keeps its day', a['2'] === 1, JSON.stringify(a));
  ok('  ...in a single request, not one per scene', h.sent.length === 1, String(h.sent.length));
  ok('the number moved is tracked',
     (h.tracked.filter(t => t.n === 'scene_moved')[0] || {}).p.scenes_moved === 2,
     JSON.stringify(h.tracked));

  h = harness({ schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [1, 2]), day(2, [3])]) });
  await h.move([1, 2], 1);
  ok('a group already on the target day does nothing', h.sent.length === 0, String(h.sent.length));

  h = harness({ schedule: sched([day(1, [1, 2]), day(2, [3])]), reply: sched([day(1, [2]), day(2, [3, 1])]) });
  await h.move([1, 3], 2);
  ok('a scene already on the target day is not counted as moved',
     (h.tracked.filter(t => t.n === 'scene_moved')[0] || {}).p.scenes_moved === 1,
     JSON.stringify(h.tracked.map(t => t.p)));

  h = harness({ schedule: sched([day(1, [1, 2])]), reply: sched([day(1, [2]), day(2, [1])]) });
  await h.move([1, 999], 2);
  a = (h.sent[0] || {}).day_assignment || {};
  ok('a scene the schedule does not have is dropped, not invented',
     a['999'] === undefined && Object.keys(a).sort().join() === '1,2', JSON.stringify(a));

  console.log('\nGuards on the rendering');
  ok('the scope is chosen before the day',
     APP.indexOf('Take with it') > 0 && APP.indexOf('Take with it') < APP.indexOf('To which day'),
     'take=' + APP.indexOf('Take with it') + ' day=' + APP.indexOf('To which day'));
  ok('scope defaults to just this scene',
     /label: 'Just this scene', ids: \[idx\]/.test(APP));
  ok('at most two cast options, so a phone is not a wall of buttons',
     /\.slice\(0, 2\)/.test(APP));
  ok('the day button reads the chosen scope rather than one scene',
     /trow && trow\.getAttribute\('data-ids'\)/.test(APP));
  ok('scene numbers render as buttons carrying their index',
     /class="ws-scene-chip" data-idx="' \+ s\.scene_index/.test(APP));
  ok('the click handler is assigned, not stacked on every render',
     /out\.onclick = function/.test(APP) && !/out\.addEventListener\('click'/.test(APP));
  ok('tap targets meet the 44px minimum', /min-height:44px/.test(APP));
  ok('the first-pass note is not dismissible', !/dismiss/i.test(APP.slice(APP.indexOf('This is a first pass'), APP.indexOf('This is a first pass') + 900)));
  ok('a new day can be created from the move row', /\+ Day ' \+ \(days\.length \+ 1\)/.test(APP));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
