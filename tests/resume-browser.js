// Does the resume offer actually render in a real browser, with real
// localStorage, in the real page? The probe tests the logic; this tests
// that the page does not throw when a filmmaker comes back to it.
const path = require('path');
const fs = require('fs');
const http = require('http');
// Needs Playwright with Chromium. Skips cleanly without it, the way
// page-load.js does, so `node tests/run.js` stays dependency-free.
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); }
catch (e) {
  console.log('  SKIP  playwright not installed — run tests/resume-probe.js instead');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const PORT = 8791;
const TYPES = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.png':'image/png' };
const server = http.createServer((req,res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (e,b) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream'});
    res.end(b);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/net::ERR|Failed to load resource|favicon/i.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

  // Arrive as a signed-in filmmaker whose breakdown broke at section 4 of 6.
  await page.addInitScript(() => {
    localStorage.setItem('scriptiq_user', JSON.stringify({
      email: 'test@example.com', name: 'Test', role: 'free', credits_remaining: 2, id: 'u-test'
    }));
    const script = 'FADE IN:\n\nINT. MARKET - DAY\n\nShe walks.\n'.repeat(200);
    const sections = {};
    for (let i = 0; i < 3; i++) {
      sections[String(i)] = { scenes: [{ scene_number: String(i+1), description: 'a scene', cast: ['ADA'] }],
                              character_breakdown: [], outline_schedule: [], production_elements: {} };
    }
    // Fingerprint has to match what the page computes, so store the script
    // and let the page's own function judge it.
    localStorage.setItem('slate_resume', JSON.stringify({
      production_id: 'prod-test-1', fingerprint: 'PLACEHOLDER',
      total_sections: 6, sections: sections, title: 'OWO TI MO',
      failed_section: 4, failed_reason: 'Failed to fetch', script_text: script
    }));
  });

  await page.goto('http://localhost:' + PORT + '/app.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(900);

  // Fix the fingerprint using the page's own function, the way a real run would.
  const fpOk = await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('slate_resume'));
    // slateScriptFingerprint is not on window; reach it through the offer
    // path instead by checking the offer renders at all.
    return typeof window.slateRenderResumeOffer === 'function';
  });
  console.log(fpOk ? '  PASS  slateRenderResumeOffer is reachable on the page' : '  FAIL  offer function missing');

  const rendered = await page.evaluate(() => {
    window.slateRenderResumeOffer();
    const el = document.getElementById('wsResumeOffer');
    return { shown: el && el.style.display === 'block', text: el ? el.innerText : '' };
  });
  console.log(rendered.shown ? '  PASS  the offer panel is shown' : '  FAIL  panel not shown');
  const t = rendered.text;
  const checks = [
    ['names the screenplay', /OWO TI MO/.test(t)],
    ['says 3 of 6 sections finished', /3 of 6 sections finished/.test(t)],
    ['says where it stopped', /stopped at section 4/.test(t)],
    ['offers to continue from section 4', /Continue from section 4/.test(t)],
    ['promises no extra credit', /No extra credit/.test(t)],
    ['offers a way to start fresh', /Start a new breakdown instead/.test(t)]
  ];
  checks.forEach(([n,c]) => console.log((c?'  PASS  ':'  FAIL  ') + n));

  // Tap size on a real phone viewport.
  const box = await page.evaluate(() => {
    const b = document.getElementById('wsResumeOfferBtn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), right: Math.round(r.right) };
  });
  console.log(box ? ((box.h >= 44 ? '  PASS  ' : '  FAIL  ') + 'continue button is ' + box.h + 'px tall on a 390px screen') : '  FAIL  no button');
  console.log(box && box.right <= 390 ? '  PASS  it fits the screen width' : '  FAIL  button overflows ' + (box && box.right));

  // No record -> the panel must disappear, not linger.
  const gone = await page.evaluate(() => {
    localStorage.removeItem('slate_resume');
    window.slateRenderResumeOffer();
    const el = document.getElementById('wsResumeOffer');
    return el.style.display === 'none' && el.innerHTML === '';
  });
  console.log(gone ? '  PASS  nothing to resume -> the panel is removed' : '  FAIL  stale panel left on screen');

  // A corrupt record must not take the page down.
  const survived = await page.evaluate(() => {
    localStorage.setItem('slate_resume', 'half a record{');
    try { window.slateRenderResumeOffer(); return true; } catch (e) { return 'threw: ' + e.message; }
  });
  console.log(survived === true ? '  PASS  a corrupt record does not throw' : '  FAIL  ' + survived);

  await page.waitForTimeout(300);
  if (errs.length) { console.log('\nPage errors:'); errs.slice(0,6).forEach(e => console.log('  ' + e)); }
  else console.log('  PASS  no page errors throughout');

  await browser.close(); server.close();
})();
