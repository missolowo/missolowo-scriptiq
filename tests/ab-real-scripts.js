// Old code vs new code, on real screenplays. Run this before shipping any
// change to scene-heading detection.
//
//   node tests/ab-real-scripts.js <git-ref> <script.txt> [more.txt ...]
//   node tests/ab-real-scripts.js production ~/scripts/*.txt
//
// It extracts the heading functions from the named ref's app.html and from
// the working copy, runs both over each script, and prints every field that
// changed. Exits non-zero if anything did.
//
// Why this exists: on 16 November a change to scene-heading detection passed
// all 442 assertions and still broke LORI NKAN MI — 47 scenes read as 53,
// green to amber — and made IRIRI report three duplicate scene numbers where
// it has one. Every fixture in the suite put the scene number ON the heading
// line. Nollywood scripts mostly put it on a line of its own. No assertion
// was wrong; the suite simply had never seen the shape.
//
// A fixture for that shape now lives in korean-probe.js, but fixtures only
// cover what someone thought to write down. Real screenplays are the only
// thing that covers what nobody thought of. Scripts are not in this repo and
// must not be committed — pass paths to plain-text copies.
const { execFileSync } = require('child_process');
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');

const [ref, ...files] = process.argv.slice(2);
if (!ref || !files.length) {
  console.error('usage: node tests/ab-real-scripts.js <git-ref> <script.txt> [...]');
  process.exit(2);
}

function api(source, label) {
  function block(n) {
    const s = source.indexOf(n);
    if (s < 0) throw new Error('missing ' + n + ' in ' + label);
    let d = 0, e = -1;
    for (let j = source.indexOf('{', s); j < source.length; j++) {
      if (source[j] === '{') d++;
      else if (source[j] === '}') { d--; if (!d) { e = j + 1; break; } }
    }
    return source.slice(s, e);
  }
  function stmt(n) {
    const s = source.indexOf(n);
    if (s < 0) throw new Error('missing ' + n + ' in ' + label);
    return source.slice(s, source.indexOf(';', s) + 1);
  }
  const HEAD = ['var SLATE_HEAD =', 'var SLATE_NUM  =', 'var SLATE_SCENE_MARKER',
    'var SLATE_NUM_ONLY_SRC', 'var slateHeadingSrc', 'var SLATE_ROWS_PER_PAGE',
    'var SLATE_CHARS_PER_ROW'].map(stmt).join('\n');
  const SRC = HEAD + '\n' + ['function slateCleanSceneNumber', 'function slateSceneTypeFrom',
    'function slateRowsIn', 'function slateEighthsFromRows', 'function slateNearMatch',
    'function slateHealthCheck', 'function slateCountScenes', 'function slateSceneMarksIn']
    .map(block).join('\n');
  return new Function('window', 'console', SRC +
    '; return { check: slateHealthCheck, count: slateCountScenes, marks: slateSceneMarksIn };')(
    {}, { warn() {}, error() {}, log() {} });
}

const OLD = api(execFileSync('git', ['show', ref + ':app.html'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), ref);
const NEW = api(fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8'), 'working copy');

// Every field a filmmaker would notice. The panel's own numbers first,
// because that is the part that tells them whether we can read their script.
const FIELDS = [
  // What the filmmaker actually reads, reproduced from renderHealthPanel.
  // This line exists because the raw sceneCount below was once labelled
  // "panel scene count", and on 16 November that label convinced me the
  // panel was under-reporting LORI NKAN MI by nine scenes. It was not:
  // sceneCount counts HEADINGS, sceneTotal counts SCENES, the panel shows
  // the latter, and the code said so in a comment I had not read. Compare
  // the sentence, not the field.
  ['panel headline',    r => slateHeadline(r.h)],
  ['panel score',       r => r.h.score],
  ['panel band',        r => r.h.band],
  ['headings matched',  r => r.h.sceneCount],   // internal; NOT what is shown
  ['scenes counted',    r => r.h.sceneTotal],   // internal; this is what is shown
  ['panel findings',    r => JSON.stringify((r.h.findings || []).map(f => f.title))],
  ['splitter total',    r => r.c.total],
  ['splitter numbered', r => r.c.numbered],
  ['splitter numbers',  r => JSON.stringify(r.c.numbers)],
  ['report numbers',    r => JSON.stringify(r.m.map(x => x.number))],
  ['report types',      r => JSON.stringify(r.m.map(x => x.type))],
  ['report eighths',    r => JSON.stringify(r.m.map(x => x.eighths))],
  ['report pages',      r => JSON.stringify(r.m.map(x => x.rows))]
];

// Kept in step with renderHealthPanel by hand. If that line changes shape,
// change it here too — a harness that reports a sentence nobody sees is
// worse than one that reports a number nobody sees.
function slateHeadline(h) {
  return h.numbered
    ? h.numbered + ' scene' + (h.numbered > 1 ? 's' : '') + ' numbered in the script'
      + (h.unnumbered ? ' · ' + h.unnumbered + ' heading'
          + (h.unnumbered > 1 ? 's' : '') + ' with no number' : '')
    : (h.sceneTotal || h.sceneCount) + ' scene'
      + ((h.sceneTotal || h.sceneCount) === 1 ? '' : 's') + ' found'
      + (h.sceneTotal ? ' · this script numbers no scenes' : '');
}

let diffs = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const run = a => ({ h: a.check(text), c: a.count(text), m: a.marks(text) });
  const o = run(OLD), n = run(NEW);
  const row = (t, r) => '  ' + t.padEnd(4) +
    '  score ' + String(r.h.score).padStart(3) + ' ' + r.h.band.padEnd(6) +
    '  splitter ' + String(r.c.total).padStart(4) +
    '  | ' + slateHeadline(r.h);

  console.log('\n' + __p.basename(file));
  console.log(row(ref.slice(0, 4), o));
  console.log(row('new', n));

  for (const [label, get] of FIELDS) {
    const a = String(get(o)), b = String(get(n));
    if (a === b) continue;
    diffs++;
    console.log('    CHANGED  ' + label);
    console.log('      ' + ref + ': ' + a.slice(0, 300));
    console.log('      new: ' + b.slice(0, 300));
  }
}

console.log('\n' + (diffs
  ? diffs + ' DIFFERENCE(S) — each one is a filmmaker seeing something new. Intended?'
  : 'identical on ' + files.length + ' real screenplay(s)'));
process.exit(diffs ? 1 : 0);
