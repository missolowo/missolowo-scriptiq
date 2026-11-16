// The funnel events, actually fired, in a real browser.
//
//   node tests/funnel-browser.js
//
// funnel-probe proves the calls are WRITTEN. This proves they ARRIVE: it
// loads the page, captures what reaches gtag, and drives the three steps a
// filmmaker takes before any breakdown exists. A siqTrack call that throws,
// or sits in a handler that never runs, or is swallowed by a guard, passes
// every static assertion and reports nothing.
//
// That is not hypothetical. app.html carried eighteen siqTrack calls and no
// GA4 tag for months: typeof gtag was never 'function', every call was
// dropped by its own guard, and the workspace reported nothing at all while
// looking fully instrumented.
const { chromium } = require('playwright');
const __p = require('path');

const ROOT = __p.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('file://' + __p.join(ROOT, 'app.html'));
  await page.waitForTimeout(400);

  // Recorded at dataLayer, not by replacing gtag. A global `function gtag(){}`
  // declaration overwrites any property defined before it, so an interceptor
  // installed up front is simply gone by the time the handlers run — and
  // silently, which cost twenty minutes. Wrapping dataLayer.push also tests
  // the real path the events take: siqTrack → gtag → dataLayer.
  await page.evaluate(() => {
    window.__events = [];
    window.dataLayer = window.dataLayer || [];
    const orig = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function (...a) {
      const x = a[0];
      if (x && x[0] === 'event') window.__events.push([x[1], Object.assign({}, x[2])]);
      return orig(...a);
    };
  });

  // The guard is tested by setting it, not by hoping the hostname triggers
  // it: a file:// page has an EMPTY hostname, so it matches neither
  // 'localhost' nor '--' and is not treated as a preview. That is fine for
  // a deployment — Netlify previews all carry '--' — but it means a test
  // that assumed the guard was on here was asserting nothing.
  const guard = await page.evaluate(() => {
    window.siqIsPreview = true;
    const before = window.__events.length;
    window.siqTrack('guard_check', {});
    const blocked = window.__events.length === before;
    window.siqIsPreview = false;
    window.siqTrack('guard_check', {});
    const passed = window.__events.length > before;
    window.__events.length = 0;
    return { blocked: blocked, passed: passed };
  });
  ok('a preview sends nothing', guard.blocked,
     'every deploy-preview run would otherwise land in the production property');
  ok('  ...and a real visit sends normally', guard.passed,
     'a guard that blocks everything is the same as no analytics at all');

  // And the expression itself, on the hostnames that matter.
  const hosts = await page.evaluate(() => {
    const isPreview = h => /deploy-preview|--/.test(h) || h === 'localhost';
    return {
      live: isPreview('missolowo.com'),
      netlify: isPreview('missolowo-scriptiq.netlify.app'),
      preview: isPreview('6afb1a87b02c4964346dda73--missolowo-scriptiq.netlify.app'),
      local: isPreview('localhost')
    };
  });
  ok('missolowo.com is not a preview', hosts.live === false);
  ok('  ...nor the netlify.app canonical', hosts.netlify === false);
  ok('a deploy preview IS one', hosts.preview === true,
     'this is the hostname shape Netlify actually produces');
  ok('  ...and so is localhost', hosts.local === true);

  const since = async () => page.evaluate(() => { const e = window.__events.slice(); window.__events.length = 0; return e; });
  await since();

  // ── 1. Opening the sign-in box ──
  await page.evaluate(() => window.openAuthModal('signup'));
  let ev = await since();
  ok('opening signup fires auth_opened',
     ev.some(e => e[0] === 'auth_opened' && e[1].tab === 'signup'), JSON.stringify(ev));
  ok('  ...exactly once', ev.filter(e => e[0] === 'auth_opened').length === 1, JSON.stringify(ev));

  // ── 2. Submitting the signup form with nothing in it ──
  await page.evaluate(() => window.handleSignupInline());
  ev = await since();
  ok('an empty signup fires signup_failed/missing_fields',
     ev.some(e => e[0] === 'signup_failed' && e[1].reason === 'missing_fields'), JSON.stringify(ev));
  ok('  ...and does NOT report a submission',
     !ev.some(e => e[0] === 'signup_submitted'),
     'nothing was sent anywhere, so counting it as a submission inflates the funnel');

  // ── 3. Pressing Generate with no screenplay ──
  await page.evaluate(() => document.getElementById('generateBtn').click());
  ev = await since();
  ok('Generate with no script fires breakdown_blocked/no_script',
     ev.some(e => e[0] === 'breakdown_blocked' && e[1].reason === 'no_script'), JSON.stringify(ev));

  // ── 4. A real signup attempt, refused by the server ──
  // The address is deliberately invalid so no account can be created. What
  // is being checked is that the REASON reaches analytics and the address
  // does not.
  await page.evaluate(() => {
    document.getElementById('signupEmail2').value = 'not-an-address';
    document.getElementById('signupPassword2').value = 'abc';
    document.getElementById('signupName2').value = 'Test Person';
    window.handleSignupInline();
  });
  await page.waitForTimeout(2500);
  ev = await since();
  ok('a filled signup reports signup_submitted',
     ev.some(e => e[0] === 'signup_submitted'), JSON.stringify(ev));
  const failed = ev.find(e => e[0] === 'signup_failed');
  ok('  ...and a refusal reports a bucketed reason',
     !failed || typeof failed[1].reason === 'string',
     JSON.stringify(failed));
  ok('  ...that is one of the known categories',
     !failed || ['password_rule', 'email_taken', 'email_invalid', 'wrong_credentials',
                 'rate_limited', 'needs_confirmation', 'network', 'other']
                 .indexOf(failed[1].reason) >= 0,
     JSON.stringify(failed));
  ok('  ...and nothing that was typed into the form',
     !JSON.stringify(ev).includes('not-an-address')
     && !JSON.stringify(ev).includes('Test Person')
     && !JSON.stringify(ev).includes('abc'),
     JSON.stringify(ev));

  // ── 5. The tracker survives a broken gtag ──
  const survived = await page.evaluate(() => {
    const real = window.gtag;
    window.gtag = function () { throw new Error('analytics down'); };
    let threw = false;
    try { window.siqTrack('whatever', {}); } catch (e) { threw = true; }
    window.gtag = real;
    return !threw;
  });
  ok('a failing gtag never throws into the product', survived,
     'a filmmaker losing a breakdown because analytics was down is the worst trade in this file');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
