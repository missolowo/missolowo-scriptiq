// The story-day pass, run in a real browser, against a real failure.
//
//   node tests/storyday-browser.js
//
// WHY THIS FILE EXISTS
//
// storyday-pass-probe.js reads the source and asserts its shape. That is
// how the 24 November bug got through: the shape was right, and the call
// still returned nothing, because bare fetch() sends no bearer token and
// slateAuthenticate refused it. A regex cannot see a 401.
//
// So this loads app.html in a browser, calls the shipped function with the
// network made to fail the way it actually failed, and reads what the
// function recorded. The point is not that it survives — the probe asserts
// that. The point is that the outcome is LEGIBLE afterwards: on the live
// run the fields were absent entirely, and an absence had to be reasoned
// about across three files. A failure should name itself.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const fs = require('fs');
const { chromium } = require('playwright');

const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

// Lift the two shipped functions out of app.html by brace matching. They
// live inside the page's closure and are deliberately NOT on window — a
// test-only global in production is a worse trade than this. What runs
// below is the file's own source text, in a real engine, so the awaits,
// the throw and the finally behave exactly as they do in the browser.
function block(needle) {
  const i = APP.indexOf(needle);
  if (i < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let d = 0, end = -1;
  for (let j = APP.indexOf('{', i); j < APP.length; j++) {
    if (APP[j] === '{') d++;
    else if (APP[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  return APP.slice(i, end);
}
const SOURCE = block('function slateStoryDay(value)') + '\n'
             + block('async function slateInferStoryDays(bd)') + '\n'
             + 'window.slateStoryDay = slateStoryDay;\n'
             + 'window.slateInferStoryDays = slateInferStoryDays;\n';

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// A breakdown shaped like the merge produces one: scenes with the writer's
// own marks on some, and the instrumentation block the pass writes into.
function fixture() {
  return {
    scenes: [
      { scene_index: 1, scene_number: '1', story_day: 'Day 1' },  // the writer's
      { scene_index: 2, scene_number: '2' },
      { scene_index: 3, scene_number: '3' }
    ],
    production_elements: { slate_reading: {} }
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><title>t</title>');
  await page.addScriptTag({ content: SOURCE });

  ok('the shipped source runs',
     await page.evaluate(() => typeof window.slateInferStoryDays === 'function'));

  // ── 1. The bug as it actually happened ──
  console.log('\nA refused request names itself');
  {
    const out = await page.evaluate(async (bd) => {
      window.slateFetch = async () => ({ ok: false, status: 401,
        json: async () => ({}) });
      const r = await window.slateInferStoryDays(bd);
      return { reading: r.production_elements.slate_reading, scenes: r.scenes };
    }, fixture());

    ok('the outcome is recorded, not absent',
       out.reading.story_days_skipped === 'http_401',
       JSON.stringify(out.reading)
       + ' — on the live run these fields were missing entirely, which is '
       + 'indistinguishable from a script that states no days');
    ok('  ...and says nothing was applied',
       out.reading.story_days_inferred === 0, JSON.stringify(out.reading));
    ok('  ...and counts every scene as unknown',
       out.reading.story_days_unknown === 3, JSON.stringify(out.reading));
    ok('the breakdown is handed back untouched',
       out.scenes.length === 3 && out.scenes[0].story_day === 'Day 1'
       && !out.scenes[1].story_day,
       'a failed pass must not be a lost breakdown');
    ok('  ...and nothing is marked as inferred',
       !out.scenes.some(s => s.story_day_inferred));
  }

  // ── 2. A request that throws before any response ──
  console.log('\nA dropped connection is recorded too');
  {
    const out = await page.evaluate(async (bd) => {
      window.slateFetch = async () => { throw new Error('network'); };
      const r = await window.slateInferStoryDays(bd);
      return r.production_elements.slate_reading;
    }, fixture());
    ok('the throw is recorded as a throw', out.story_days_skipped === 'threw',
       JSON.stringify(out));
    ok('  ...and the counters are still written',
       out.story_days_unknown === 3, JSON.stringify(out));
  }

  // ── 3. The path that works ──
  console.log('\nA good answer is applied, and the writer still wins');
  {
    const out = await page.evaluate(async (bd) => {
      window.slateFetch = async () => ({ ok: true, status: 200, json: async () => ({
        story_days: [
          { index: 1, day: 'Day 9' },   // contradicts the writer: ignored
          { index: 2, day: '2' },
          { index: 3, day: 'NIGHT' }    // not a story day: rejected
        ]
      }) });
      const r = await window.slateInferStoryDays(bd);
      return { reading: r.production_elements.slate_reading, scenes: r.scenes };
    }, fixture());

    ok('the writer’s own mark is not overwritten',
       out.scenes[0].story_day === 'Day 1'
       && !out.scenes[0].story_day_inferred,
       JSON.stringify(out.scenes[0])
       + ' — the page is the authority; the model reads it');
    ok('a real day is applied and marked as ours',
       out.scenes[1].story_day === '2' && out.scenes[1].story_day_inferred === true,
       JSON.stringify(out.scenes[1]));
    ok('a time-of-day word is refused',
       !out.scenes[2].story_day,
       JSON.stringify(out.scenes[2])
       + ' — "NIGHT" on a continuity line groups scenes that share nothing');
    ok('the count is of what was applied, not of what was returned',
       out.reading.story_days_inferred === 1, JSON.stringify(out.reading));
    ok('  ...and unknown counts the rest',
       out.reading.story_days_unknown === 2, JSON.stringify(out.reading));
    ok('  ...and distinct days counts the writer’s too',
       out.reading.distinct_story_days === 2, JSON.stringify(out.reading));
  }

  // ── 4. The instrumentation must never be the thing that breaks ──
  console.log('\nA breakdown with no instrumentation block still comes back');
  {
    const out = await page.evaluate(async () => {
      window.slateFetch = async () => ({ ok: true, status: 200, json: async () => ({
        story_days: [{ index: 1, day: '1' }] }) });
      const r = await window.slateInferStoryDays(
        { scenes: [{ scene_index: 1, scene_number: '1' }] });
      return { day: r.scenes[0].story_day, hasPe: !!r.production_elements };
    });
    ok('an older breakdown is still read', out.day === '1',
       'a saved breakdown from before the instrumentation existed');
    ok('  ...and nothing was invented to hold counters', !out.hasPe);
  }

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
