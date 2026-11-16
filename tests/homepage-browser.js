// How far down the homepage people get, measured by actually scrolling it.
//
//   node tests/homepage-browser.js
//
// In the 30 days to 16 November, 246 people reached the homepage and 39
// reached the workspace. The page recorded clicks and nothing else, so a
// visitor who left after two seconds and a visitor who read to the end and
// still did not sign up were indistinguishable. Those need opposite fixes —
// a stronger first screen, or a shorter page — and we were guessing.
//
// This drives a real browser down the real page at phone width and checks
// the events arrive, once each, in order. A section-depth measurement is
// easy to write and easy to get subtly wrong: a threshold expressed as a
// percentage of the section silently never fires for any section taller
// than the screen, which on a phone is most of them, and the result looks
// like a page nobody scrolls rather than a broken observer.
const { chromium } = require('playwright');
const __p = require('path');

const ROOT = __p.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

(async () => {
  const browser = await chromium.launch();
  // A phone, because that is what most of this traffic is on, and because
  // it is the case where a percentage-of-section threshold fails.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));

  // Installed BEFORE the page loads. The sections already on screen at
  // load fire immediately, so a recorder installed after goto() misses the
  // hero — and the first run of this test reported the top three sections
  // as never reached when they had in fact fired before anything was
  // listening.
  await page.addInitScript(() => {
    window.__events = [];
    window.dataLayer = window.dataLayer || [];
    const orig = Array.prototype.push.bind(window.dataLayer);
    window.dataLayer.push = function (...a) {
      const x = a[0];
      if (x && x[0] === 'event') window.__events.push([x[1], Object.assign({}, x[2])]);
      return orig(...a);
    };
  });

  await page.goto('file://' + __p.join(ROOT, 'index.html'));
  await page.waitForTimeout(600);

  const sectionCount = await page.evaluate(() => document.querySelectorAll('section').length);
  ok('the page has sections to measure', sectionCount >= 8, sectionCount + ' found');

  // Scroll the whole page the way a reader would, not in one jump: an
  // observer that only fires on a settled position would pass a single
  // jump to the bottom and record nothing in between.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    const end = document.body.scrollHeight;
    for (let y = 0; y < end; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 90));
    }
    window.scrollTo(0, end);
    await new Promise(r => setTimeout(r, 400));
  });

  const ev = await page.evaluate(() => window.__events.slice());
  const seen = ev.filter(e => e[0] === 'home_section_seen').map(e => e[1].section);

  ok('every section reported being reached', seen.length === sectionCount,
     seen.length + ' of ' + sectionCount + ': ' + JSON.stringify(seen));
  ok('  ...each exactly once', new Set(seen).size === seen.length, JSON.stringify(seen));
  ok('  ...in the order they appear on the page',
     JSON.stringify(seen) === JSON.stringify(seen.slice().sort()),
     JSON.stringify(seen));
  ok('  ...and the names are readable, not class soup',
     seen.every(s => /^\d\d_[a-z]+$/.test(s)), JSON.stringify(seen));
  ok('the documents section is in there',
     seen.some(s => /_docs$/.test(s)),
     'this is the section that proves the product is real — its count is the number that matters');
  ok('  ...and it sorts after the hero',
     seen.findIndex(s => /_docs$/.test(s)) > seen.findIndex(s => /_hero$/.test(s)),
     JSON.stringify(seen));

  // Scrolling back up must not double-count: it is the same visitor.
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 300));
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 400));
  });
  const after = await page.evaluate(() =>
    window.__events.filter(e => e[0] === 'home_section_seen').length);
  ok('scrolling the page again reports nothing new', after === seen.length,
     after + ' vs ' + seen.length + ' — one reader would otherwise count as several');

  // The CTA tracking that was already here must still work.
  await page.evaluate(() => { window.__events.length = 0; });
  // The CTA is a real link, so the click has to be stopped or the page
  // navigates and the recorder goes with it. The handler under test runs
  // on the document, so it still sees the click.
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('[data-cta="hero"]');
    if (!el) return 'no hero cta found';
    const stop = e => e.preventDefault();
    document.addEventListener('click', stop);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.removeEventListener('click', stop);
    return window.__events.some(e => e[0] === 'home_cta_click'
      && e[1].cta_location === 'hero') ? 'tracked' : 'not tracked';
  });
  ok('the hero CTA still reports a click, with its location', clicked === 'tracked', clicked);

  ok('nothing personal in any event',
     !JSON.stringify(ev).includes('@'), JSON.stringify(ev).slice(0, 160));
  ok('no page errors throughout', errs.length === 0, JSON.stringify(errs.slice(0, 3)));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
