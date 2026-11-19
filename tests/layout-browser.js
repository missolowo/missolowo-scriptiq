// A PDF page is a layout, not a stream of words.
//
//   node tests/layout-browser.js [script.pdf]
//
// On 18 November a filmmaker's shooting script came back with 99 scenes and
// NOT ONE scene number, and every time of day corrupted — "SUNDOWN1",
// "CONTINUOUS2". The script was clean. We were reading it wrongly.
//
// The reader walked pdf.js's text items in the order the PDF file happened
// to store them and started a new line whenever the vertical position moved.
// It never looked at the horizontal position. A shooting script puts its
// scene number in BOTH margins:
//
//     1   EXT. WOODS – SUNDOWN                                      1
//
// and this PDF stored the slug line first and the two margin numbers after
// it, so the reader produced "EXT. WOODS – SUNDOWN1 1". The leading number
// was no longer at the start of the line, so nothing could read it, and the
// trailing one was glued to the time of day.
//
// That is the whole of this file: items arriving out of order, which is
// normal and permitted, must still come out in reading order. The assertions
// are written against item lists in the SAME shape pdf.js produced for that
// script — slug first, margins after — because a fixture in tidy order would
// have passed against the broken reader too.
const { chromium } = require('playwright');
const __p = require('path');
const fs = require('fs');

const ROOT = __p.resolve(__dirname, '..');
const REAL_PDF = process.argv[2] || null;

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// A pdf.js text item, as the library actually shapes one.
const item = (str, x, y, w) => ({ str: str, width: w === undefined ? str.length * 7.2 : w,
                                  transform: [12, 0, 0, 12, x, y] });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + __p.join(ROOT, 'app.html'));
  await page.waitForTimeout(600);

  // Taken from app.html's own source, so this cannot drift into testing a
  // copy of the reader that no longer matches the product.
  const src = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
  const start = src.indexOf('function slatePageItemsToText');
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  ok('slatePageItemsToText was found in app.html', start > 0 && end > start);
  await page.evaluate(fn => window.eval(fn + '\nwindow.__lay = slatePageItemsToText;'),
                      src.slice(start, end));
  const lay = async (items) => page.evaluate(i => window.__lay(i), items);

  // ══════════════════════════════════════════════════
  console.log('\nThe bug, exactly as the PDF delivered it');
  {
    // Slug line first, then BOTH margin numbers — the order that broke it.
    const out = await lay([
      item('EXT. WOODS – SUNDOWN', 158, 700),
      item('1', 86, 700, 7.2),
      item('1', 540, 700, 7.2)
    ]);
    ok('the scene number is back at the start of the line',
       /^\s*1\s/.test(out), JSON.stringify(out));
    ok('  ...and the time of day is not corrupted',
       /SUNDOWN(\s|$)/.test(out) && !/SUNDOWN1/.test(out), JSON.stringify(out));
    ok('  ...and it is still one line, not three',
       out.split('\n').length === 1, JSON.stringify(out));
    ok('the right margin number is still there, separated',
       /SUNDOWN\s+1\s*$/.test(out), JSON.stringify(out));
    // The whole point: the product's own reader must now find a number here.
    const num = await page.evaluate(
      t => (t.match(/^[ \t]*([0-9]+)[ \t]+(INT|EXT)/) || [])[1] || null, out);
    ok('a numbered-heading reader finds 1 on this line', num === '1', String(num));
  }

  console.log('\nOrder comes from the page, not from the file');
  {
    const out = await lay([
      item('WORLD', 200, 500), item('HELLO', 100, 500)   // stored backwards
    ]);
    ok('items are read left to right', /HELLO\s+WORLD/.test(out), JSON.stringify(out));
  }
  {
    const out = await lay([
      item('SECOND', 100, 400), item('FIRST', 100, 500)  // stored bottom-up
    ]);
    ok('lines are read top to bottom',
       out.indexOf('FIRST') < out.indexOf('SECOND'), JSON.stringify(out));
  }

  // ══════════════════════════════════════════════════
  console.log('\nA gap is a space; a split word is not');
  {
    // pdf.js routinely splits one word into several items with no gap at all.
    // Putting a space between those would corrupt every long word on the page.
    const out = await lay([
      item('CONTIN', 100, 300, 43.2), item('UOUS', 143.2, 300, 28.8)
    ]);
    ok('a word split across items stays one word',
       /CONTINUOUS/.test(out), JSON.stringify(out));
  }
  {
    const out = await lay([
      item('INT. KITCHEN', 100, 300, 86.4), item('DAY', 400, 300, 21.6)
    ]);
    ok('a real gap becomes spaces',
       /INT\. KITCHEN\s{2,}DAY/.test(out), JSON.stringify(out));
    ok('  ...but not hundreds of them',
       !/ {40}/.test(out), 'longest run ' + (out.match(/ +/g) || []).sort((a, b) => b.length - a.length)[0].length);
  }
  {
    // Two words set normally, one space apart.
    const out = await lay([
      item('ADA', 100, 300, 21.6), item('ENTERS', 128.8, 300, 43.2)
    ]);
    ok('ordinary word spacing survives as one space',
       /ADA ENTERS/.test(out), JSON.stringify(out));
  }

  console.log('\nRows are grouped by baseline, not by exact equality');
  {
    // A margin number set a hair off the slug line's baseline is still on it.
    const out = await lay([
      item('INT. ROOM - DAY', 158, 700.0),
      item('12', 86, 701.4, 14.4)
    ]);
    ok('a baseline within a few units is the same line',
       out.split('\n').length === 1 && /^\s*12\s+INT/.test(out), JSON.stringify(out));
  }
  {
    // A genuinely different line is not folded in.
    const out = await lay([
      item('INT. ROOM - DAY', 158, 700),
      item('Ada enters.', 158, 676)
    ]);
    ok('a real new line stays a new line',
       out.split('\n').length === 2, JSON.stringify(out));
  }

  console.log('\nAnd nothing it is given can make it throw');
  {
    ok('an empty page is an empty string', (await lay([])) === '');
    const out = await lay([
      { str: '', width: 0, transform: [12, 0, 0, 12, 10, 10] },
      { str: 'A', transform: [12, 0, 0, 12, 20, 10] }       // no width at all
    ]);
    ok('an item with no width and an empty item are survivable',
       typeof out === 'string' && /A/.test(out), JSON.stringify(out));
  }

  // ══════════════════════════════════════════════════
  // app.html loads pdf.js from a CDN a sandboxed browser usually cannot
  // reach. Point PDFJS_PATH at a local pdf.min.js of the version app.html
  // pins (3.11.174) to run this against a real screenplay:
  //   npm pack pdfjs-dist@3.11.174 && tar -xzf pdfjs-dist-*.tgz
  //   PDFJS_PATH=package/build/pdf.min.js node tests/layout-browser.js script.pdf
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
    console.log('\nThe real screenplay, old reader against new');
    const b64 = fs.readFileSync(REAL_PDF).toString('base64');
    const r = await page.evaluate(async (b) => {
      const bin = atob(b); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      let oldT = '', newT = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const items = (await (await pdf.getPage(i)).getTextContent()).items;
        let lastY = -1, t = '';                      // the reader as it was
        for (const it of items) {
          if (lastY !== -1 && Math.abs(it.transform[5] - lastY) > 5) t += '\n';
          t += it.str; lastY = it.transform[5];
        }
        oldT += t + '\n';
        newT += window.__lay(items) + '\n';
      }
      const headings = s => (s.match(/^[^\n]*\b(?:INT|EXT)\b[^\n]*$/gm) || []);
      const numbered = s => headings(s).filter(l => /^[ \t]*\d/.test(l)).length;
      // A time of day with a digit stuck to it is the corruption signature.
      const glued = s => headings(s)
        .filter(l => /(?:DAY|NIGHT|SUNDOWN|CONTINUOUS|MORNING|EVENING|LATER)\d/i.test(l)).length;
      return { pages: pdf.numPages,
               headOld: headings(oldT).length, headNew: headings(newT).length,
               numOld: numbered(oldT), numNew: numbered(newT),
               gluedOld: glued(oldT), gluedNew: glued(newT) };
    }, b64);

    console.log('    pages ' + r.pages
      + ' | headings ' + r.headOld + ' -> ' + r.headNew
      + ' | numbered ' + r.numOld + ' -> ' + r.numNew
      + ' | corrupted times ' + r.gluedOld + ' -> ' + r.gluedNew);
    ok('NO heading is lost', r.headNew >= r.headOld, r.headOld + ' -> ' + r.headNew);
    ok('no time of day has a digit stuck to it', r.gluedNew === 0, String(r.gluedNew));
    ok('at least as many headings carry their number',
       r.numNew >= r.numOld, r.numOld + ' -> ' + r.numNew);
  } else if (REAL_PDF && !havePdfjs) {
    console.log('\n(SKIPPED the end-to-end section: pdf.js is not available in this');
    console.log(' browser. Set PDFJS_PATH to a local pdf.min.js 3.11.174 to run it.)');
  } else {
    console.log('\n(no PDF passed — run with a real screenplay path to compare readers)');
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
