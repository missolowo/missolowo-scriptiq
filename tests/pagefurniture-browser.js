// Page numbers are not scene numbers.
//
//   node tests/pagefurniture-browser.js [script.pdf]
//
// On 18 November a filmmaker reported a wrong breakdown on a 215-page PDF.
// His script has 94 scenes. The product reported 135, with scenes numbered
// 151, 152, 153, 211 and 212 — numbers his script does not contain. They
// were pages 151, 152, 153, 211 and 212.
//
// It ran through the real pdf.js extractor in app.html, so that is what
// this tests: the actual extraction path, in a real browser, on a real
// screenplay — not a fixture of what a PDF is imagined to look like. The
// fixtures are generated here so the suite needs no script to run, and a
// real PDF can be passed as an argument when one is to hand.
//
// The assertion that matters most is the one that does NOT strip: a script
// whose scene numbers sit alone on their own lines must come through
// untouched. Stripping those would be far worse than the bug this fixes,
// and it is the obvious way to get this wrong.
const { chromium } = require('playwright');
const __p = require('path');
const fs = require('fs');

const ROOT = __p.resolve(__dirname, '..');
const REAL_PDF = process.argv[2] || null;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + __p.join(ROOT, 'app.html'));
  await page.waitForTimeout(600);

  // The function under test is private to its block, so it is re-created in
  // the page from app.html's own source. If the source changes, this reads
  // the change; it cannot drift into testing a copy.
  const src = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
  const fnStart = src.indexOf('function slateStripPageFurniture');
  const markLine = src.match(/var SLATE_PAGE_MARK = [^;]+;/);
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', fnStart); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  ok('slateStripPageFurniture was found in app.html', fnStart > 0 && end > fnStart);
  ok('  ...and so was the page marker', !!markLine);

  await page.evaluate(([fn, mark]) => {
    // eslint-disable-next-line no-eval
    window.eval(mark + '\n' + fn + '\nwindow.__strip = slateStripPageFurniture;'
      + '\nwindow.__MARK = SLATE_PAGE_MARK;');
  }, [src.slice(fnStart, end), markLine[0]]);

  const build = async (pages) => page.evaluate(ps => ps.join(window.__MARK), pages);
  const strip = async (text) => page.evaluate(t => window.__strip(t), text);

  // ══════════════════════════════════════════════════
  console.log('\nA paginated screenplay loses its page numbers');
  {
    const pages = [];
    for (let p = 1; p <= 20; p++) {
      pages.push('\n' + (p % 3 === 0 ? `${p}. INT. ROOM ${p} - DAY\n\nSomething happens.\n`
                                     : `Action continues on page ${p}.\n`) + '\n     ' + p + '\n');
    }
    const out = await strip(await build(pages));
    ok('the page numbers are gone',
       !/^\s*\d{1,3}\s*$/m.test(out), out.split('\n').filter(l => /^\s*\d{1,3}\s*$/.test(l)).join(','));
    ok('  ...and the scene headings are not',
       (out.match(/INT\. ROOM/g) || []).length === 6,
       String((out.match(/INT\. ROOM/g) || []).length));
    ok('  ...nor the action', /Action continues/.test(out));
    ok('the marker never reaches the model', out.indexOf('SLATE_PAGE') < 0 && !/PAGE BREAK/.test(out));
  }

  console.log('\nA running header is furniture too');
  {
    const pages = [];
    for (let p = 1; p <= 20; p++) {
      pages.push('\nTHE HILLS BETWEEN US\n\n' + p + '. INT. ROOM - DAY\n\nAction.\n');
    }
    const out = await strip(await build(pages));
    ok('the repeated header is removed',
       (out.match(/THE HILLS BETWEEN US/g) || []).length <= 1,
       String((out.match(/THE HILLS BETWEEN US/g) || []).length) + ' left');
    ok('  ...and every scene survives',
       (out.match(/INT\. ROOM/g) || []).length === 20,
       String((out.match(/INT\. ROOM/g) || []).length));
  }

  // ══════════════════════════════════════════════════
  console.log('\nTHE ONE THAT MUST NOT STRIP: bare scene numbers');
  {
    // Nollywood scripts commonly put the scene number alone on a line.
    // These are NOT page numbers and removing them would be a far worse
    // bug than the one being fixed.
    const pages = [];
    for (let p = 1; p <= 20; p++) {
      pages.push('\n' + (p * 2 - 1) + '\nEXT DAY COMPOUND\n\nA ri Adahunse.\n\n'
                 + (p * 2) + '\nINT NIGHT ILE ADA\n\nAda joko.\n');
    }
    const out = await strip(await build(pages));
    const kept = (out.match(/^\s*\d{1,3}\s*$/gm) || []).length;
    ok('all 40 bare scene numbers survive', kept === 40, kept + ' of 40 left');
    ok('  ...and so do the headings',
       (out.match(/EXT DAY COMPOUND|INT NIGHT ILE ADA/g) || []).length === 40);
  }

  console.log('\nAnd a short document is left alone entirely');
  {
    const out = await strip(await build(['\n1\nINT. A - DAY\n', '\n2\nINT. B - DAY\n']));
    ok('two pages: nothing stripped', (out.match(/^\s*\d\s*$/gm) || []).length === 2, out);
  }

  // ══════════════════════════════════════════════════
  // app.html loads pdf.js from a CDN, which a sandboxed test browser often
  // cannot reach. Point PDFJS_PATH at a local pdf.min.js of the SAME version
  // app.html pins (3.11.174) to run the end-to-end section:
  //   npm pack pdfjs-dist@3.11.174 && tar -xzf pdfjs-dist-*.tgz
  //   PDFJS_PATH=package/build/pdf.min.js node tests/pagefurniture-browser.js script.pdf
  let havePdfjs = (await page.evaluate(() => typeof pdfjsLib)) !== 'undefined';
  if (!havePdfjs && process.env.PDFJS_PATH && fs.existsSync(process.env.PDFJS_PATH)) {
    await page.addScriptTag({ path: process.env.PDFJS_PATH });
    const worker = __p.join(__p.dirname(process.env.PDFJS_PATH), 'pdf.worker.min.js');
    if (fs.existsSync(worker)) {
      await page.evaluate(w => { pdfjsLib.GlobalWorkerOptions.workerSrc = w; },
                          'file://' + worker);
    }
    havePdfjs = (await page.evaluate(() => typeof pdfjsLib)) !== 'undefined';
  }

  if (REAL_PDF && fs.existsSync(REAL_PDF) && havePdfjs) {
    console.log('\nThe real screenplay, through the real extractor');
    const buf = fs.readFileSync(REAL_PDF).toString('base64');
    const result = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      let full = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const tc = await pg.getTextContent();
        let lastY = -1, t = '';
        for (const item of tc.items) {
          if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 5) t += '\n';
          t += item.str;
          lastY = item.transform[5];
        }
        full += t + '\n' + window.__MARK + '\n';
      }
      const before = full.split(window.__MARK).join('\n\n');
      const after = window.__strip(full);
      const bareLines = s => (s.match(/^[ \t]*\d{1,4}[ \t]*$/gm) || []).length;
      const headings = s => (s.match(/^[^\n]*\b(INT|EXT)\b[^\n]*$/gm) || []).length;
      return { pages: pdf.numPages,
               bareBefore: bareLines(before), bareAfter: bareLines(after),
               headBefore: headings(before), headAfter: headings(after),
               marker: after.indexOf('SLATE_PAGE') >= 0 };
    }, buf);

    console.log('    pages: ' + result.pages
      + ' | bare-number lines ' + result.bareBefore + ' -> ' + result.bareAfter
      + ' | INT/EXT headings ' + result.headBefore + ' -> ' + result.headAfter);
    ok('most page numbers are removed',
       result.bareAfter < result.bareBefore * 0.3,
       result.bareBefore + ' -> ' + result.bareAfter);
    ok('NO scene heading is lost', result.headAfter === result.headBefore,
       result.headBefore + ' -> ' + result.headAfter);
    ok('the marker never reaches the model', !result.marker);
  } else if (REAL_PDF && !havePdfjs) {
    console.log('\n(SKIPPED the end-to-end section: pdf.js is not available in this browser.');
    console.log(' app.html loads it from a CDN the test browser cannot reach. Set PDFJS_PATH');
    console.log(' to a local pdf.min.js 3.11.174 to run it.)');
  } else {
    console.log('\n(no PDF passed — run with a real screenplay path to test extraction end to end)');
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
