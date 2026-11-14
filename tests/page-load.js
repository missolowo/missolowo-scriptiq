// Do the pages still load in a real browser?
//
// The cheapest test there is, and the one that has saved us most often.
// `node --check` is no substitute: it has twice passed a file that threw
// the moment it ran — a reference to a variable that existed only inside
// another function, and a value used before it was declared. Both would
// have been a blank screen for a filmmaker.
//
// Serves the repository over HTTP rather than file:// because the pages
// load /tokens.css by absolute path.
//
// Needs Playwright with Chromium. If it is not installed, skip this and
// run the probes; they do not need a browser.
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const PAGES = ['app.html', 'index.html', 'reset.html', 'privacy.html'];

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png'
};

const server = http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  var file = path.join(ROOT, rel);
  // Never serve outside the repository.
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

(async () => {
  let chromium, devices;
  try { ({ chromium, devices } = require('playwright')); }
  catch (e) {
    console.log('  SKIP  playwright not installed — run the probes instead');
    process.exit(0);
  }

  await new Promise(function (r) { server.listen(PORT, r); });
  const browser = await chromium.launch();
  let failed = 0;

  for (const page of PAGES) {
    if (!fs.existsSync(path.join(ROOT, page))) { console.log('  SKIP  ' + page + ' (not in repo)'); continue; }
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => {
      // Fonts and other third-party assets are blocked in CI and offline;
      // those are not our bugs.
      if (m.type() === 'error' && !/favicon|net::ERR|Failed to load resource/i.test(m.text())) errs.push(m.text());
    });
    try {
      await p.goto('http://localhost:' + PORT + '/' + page, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await p.waitForTimeout(600);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth);
      if (wide > 400) errs.push('scrolls sideways at 390px (scrollWidth ' + wide + ')');
    } catch (e) { errs.push('did not load: ' + e.message.split('\n')[0]); }

    if (errs.length) { failed++; console.log('  FAIL  ' + page + '  -> ' + errs.slice(0, 3).join(' | ')); }
    else console.log('  PASS  ' + page);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log('\n' + (PAGES.length - failed) + ' pages clean, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
