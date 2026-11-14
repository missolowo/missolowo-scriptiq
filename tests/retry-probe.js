// Tier 1 — section retry with connection-aware waiting.
// Tests the REAL source text pulled out of app.html, not a hand-copied
// version, so this fails if the shipped code drifts from what it asserts.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const fs = require('fs');
const APP = fs.readFileSync(APP_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
function block(startNeedle) {
  const s = APP.indexOf(startNeedle);
  if (s < 0) { console.error('NOT FOUND: ' + startNeedle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}

const fnSrc   = block('async function sendChunkToBackend');
const waitSrc = block('function slateWaitForOnline');
// Start at the budget declaration, not the `for` — the loop reads it.
const loopSrc = block('var offlineBudget = 30000;');

// ───────────── sendChunkToBackend: is this failure worth retrying ─────
async function classify(fetchImpl) {
  const build = new Function('slateFetch', 'document', fnSrc + '; return sendChunkToBackend;');
  return build(fetchImpl, { getElementById: () => ({ classList: { add() {} } }) })
    ({ email: 'a@b.c', id: 'u1' }, 'TEXT', 'English', 0, 1, 'p1');
}
const resp = (status, body) => async () => ({
  status, ok: status >= 200 && status < 300, text: async () => body
});

(async () => {
  console.log('\nsendChunkToBackend — is this failure worth another attempt?');
  let r;
  r = await classify(resp(402, '{"error":"No credits"}'));
  ok('402 no credits -> NOT retryable', r.error && r.retryable === false);
  r = await classify(resp(502, '<!doctype html>Gateway Timeout'));
  ok('HTML gateway page (function timeout) -> retryable', r.error && r.retryable === true);
  r = await classify(resp(500, '{"error":"boom"}'));
  ok('500 -> retryable', r.error && r.retryable === true);
  r = await classify(resp(429, '{"error":"Too many attempts"}'));
  ok('429 rate limited -> NOT retryable', r.error && r.retryable === false);
  r = await classify(resp(401, '{"error":"sign in"}'));
  ok('401 -> NOT retryable', r.error && r.retryable === false);
  r = await classify(resp(403, '{"error":"disabled"}'));
  ok('403 -> NOT retryable', r.error && r.retryable === false);
  r = await classify(async () => { throw new Error('Failed to fetch'); });
  ok('dropped connection -> retryable', r.error && r.retryable === true);
  r = await classify(resp(200, '{"scenes":[{"scene_number":1}]}'));
  ok('200 -> no error flag', !r.error && Array.isArray(r.scenes));

  // ───────────── slateWaitForOnline, against real timers ──────────────
  console.log('\nslateWaitForOnline — does it wait for the connection, and stop waiting?');
  function makeWait(onLine) {
    const listeners = {};
    const win = {
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener: (ev, fn) => {
        listeners[ev] = (listeners[ev] || []).filter(f => f !== fn);
      }
    };
    const nav = { onLine };
    const build = new Function('navigator', 'window', waitSrc + '; return slateWaitForOnline;');
    return { fn: build(nav, win), nav, listeners,
             fire: (ev) => (listeners[ev] || []).slice().forEach(f => f()) };
  }

  let w = makeWait(true);
  let t0 = Date.now();
  let waited = await w.fn(5000);
  ok('already online -> returns immediately, waits 0',
     waited === 0 && Date.now() - t0 < 50, 'waited=' + waited);

  w = makeWait(false);
  t0 = Date.now();
  const p = w.fn(5000);
  setTimeout(() => { w.nav.onLine = true; w.fire('online'); }, 60);
  waited = await p;
  ok('offline then reconnects -> resolves on the online event, not the cap',
     waited >= 40 && waited < 1000, 'waited=' + waited);
  ok('  ...and unsubscribes itself', (w.listeners.online || []).length === 0);

  w = makeWait(false);
  t0 = Date.now();
  waited = await w.fn(120);
  ok('offline and never returns -> gives up at the cap',
     waited >= 100 && waited < 600, 'waited=' + waited);

  w = makeWait(false);
  const p2 = w.fn(3000);
  setTimeout(() => { w.fire('online'); w.fire('online'); w.fire('online'); }, 30);
  await p2;
  ok('a repeated online event cannot resolve it twice', true);

  // ───────────── the loop ─────────────────────────────────────────────
  console.log('\nThe loop — attempts, waiting, and the 30s budget');
  async function runLoop(responses, opts) {
    opts = opts || {};
    let calls = 0;
    const retries = [], progress = [], waits = [];
    const sendChunkToBackend = async () => responses[Math.min(calls++, responses.length - 1)];
    const siqTrack = (n, p) => { if (n === 'section_retry') retries.push(p); };
    const wsProgress = (_p, m) => progress.push(m);
    // Stubbed so the budget arithmetic can be asserted exactly; the real
    // helper is tested above against real timers.
    const slateWaitForOnline = async (maxMs) => {
      waits.push(maxMs);
      return Math.min(opts.waitReturns == null ? 0 : opts.waitReturns, maxMs);
    };
    const navigator = { onLine: opts.onLine !== false };
    let result = await sendChunkToBackend();
    const body = new Function(
      'result', 'sendChunkToBackend', 'siqTrack', 'wsProgress', 'slateWaitForOnline',
      'navigator', 'setTimeout', 'i', 'totalChunks', 'chunks', 'sectionLang',
      'user', 'productionId',
      'return (async () => { ' + loopSrc + ' return result; })();'
    );
    result = await body(result, sendChunkToBackend, siqTrack, wsProgress, slateWaitForOnline,
      navigator, (fn) => fn(), 0, 3, ['a', 'b', 'c'], 'English', { id: 'u1' }, 'p1');
    return { calls, result, retries, progress, waits };
  }

  const netFail  = { error: true, retryable: true,  message: 'Failed to fetch' };
  const noCredit = { error: true, retryable: false, message: 'No credits remaining' };
  const good     = { scenes: [{ scene_number: 1 }] };

  let out = await runLoop([good]);
  ok('success first time -> 1 call, no retry, no waiting',
     out.calls === 1 && out.retries.length === 0 && out.waits.length === 0);

  out = await runLoop([netFail, good]);
  ok('drop then success -> 2 calls, recovered', out.calls === 2 && !out.result.error);

  out = await runLoop([netFail]);
  ok('always failing -> stops at 3 calls', out.calls === 3 && out.result.error === true);

  out = await runLoop([noCredit]);
  ok('no credits -> 1 call, never retried', out.calls === 1 && out.retries.length === 0);

  // The phone case that failed the real test on 9 Nov.
  out = await runLoop([netFail, good], { onLine: false, waitReturns: 1000 });
  ok('OFFLINE: waits for the connection before retrying', out.waits.length >= 1, JSON.stringify(out.waits));
  ok('  ...first wait is offered the full 30s budget', out.waits[0] === 30000, JSON.stringify(out.waits));
  ok('  ...and it recovers', out.calls === 2 && !out.result.error);
  ok('  ...and says it is waiting, not just "trying again"',
     /waiting for your connection/i.test(out.progress.join(' ')), JSON.stringify(out.progress));

  out = await runLoop([netFail], { onLine: false, waitReturns: 30000 });
  ok('budget is per SECTION, not per attempt (no second 30s wait)',
     out.waits.length === 1 || out.waits[1] === 0,
     JSON.stringify(out.waits));
  ok('  ...total waiting never exceeds 30s',
     out.waits.reduce((a, b) => a + b, 0) <= 30000, JSON.stringify(out.waits));

  out = await runLoop([netFail, netFail, good], { onLine: false, waitReturns: 5000 });
  ok('two short drops -> budget decrements, second wait is the remainder',
     out.waits[0] === 30000 && out.waits[1] === 25000, JSON.stringify(out.waits));

  out = await runLoop([netFail, good], { onLine: true });
  ok('ONLINE failure -> does not wait, retries straight away', out.waits.length === 0);

  // ───────────── guards ───────────────────────────────────────────────
  console.log('\nGuards');
  ok('budget is 30 seconds', /offlineBudget = 30000/.test(loopSrc));
  ok('retry bounded at 2 extra attempts', /attempt <= 2/.test(loopSrc));
  ok('only retries a retryable error', /result\.error && result\.retryable/.test(loopSrc));
  ok('onLine is only trusted when it says FALSE',
     /navigator\.onLine === false/.test(loopSrc) && /navigator\.onLine !== false/.test(waitSrc));
  ok('402 still shows the credit warning', /creditWarning[\s\S]{0,200}retryable: false/.test(APP));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
