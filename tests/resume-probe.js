// Tier 2 — resuming a breakdown that was interrupted.
//
// Three filmmakers lost their first breakdown on launch day. Tier 1 made a
// section survive a thirty-second drop. This is the rest of it: the sections
// that already finished are written down, so a longer outage, a reload, a
// dead phone or a discarded background tab can carry on from the first
// missing section instead of paying for the whole screenplay again.
//
// The dangerous failure here is NOT losing the work. It is resuming into the
// wrong screenplay — half of one film stapled to half of another, delivered
// as a breakdown somebody will shoot from. Most of what follows is about
// refusing to do that.
//
// Reads the real source out of app.html and runs it, so it fails if the
// shipped code drifts away from what it claims here.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

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

// ── Load the real helpers against a localStorage stub ──
// The stub can be told to refuse writes over a size, which is how the
// quota path gets tested without an actual phone browser.
function makeStore(limitBytes) {
  const data = {};
  return {
    store: {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => {
        if (limitBytes && String(v).length > limitBytes) {
          const e = new Error('QuotaExceededError');
          e.name = 'QuotaExceededError';
          throw e;
        }
        data[k] = String(v);
      },
      removeItem: k => { delete data[k]; }
    },
    raw: data
  };
}

const SRC = [
  block('var SLATE_RESUME_KEY'),
  block('function slateScriptFingerprint'),
  block('function slateReadResume'),
  block('function slateClearResume'),
  block('function slateResumeNextIndex'),
  block('function slateResumeDoneCount'),
  block('function slateResumeChunks'),
  block('function slateWriteResume')
].join('\n');

function load(limitBytes) {
  const s = makeStore(limitBytes);
  const api = new Function('localStorage', 'console', SRC +
    '; return { fingerprint: slateScriptFingerprint, read: slateReadResume,' +
    ' clear: slateClearResume, next: slateResumeNextIndex,' +
    ' done: slateResumeDoneCount, chunks: slateResumeChunks,' +
    ' write: slateWriteResume, KEY: SLATE_RESUME_KEY };'
  )(s.store, { warn() {}, error() {} });
  return { api, store: s.store, raw: s.raw };
}

// A record shaped the way the run builds one.
function rec(total, doneIndexes, extra) {
  const sections = {};
  doneIndexes.forEach(i => { sections[String(i)] = { scenes: [{ scene_number: String(i + 1) }] }; });
  return Object.assign({
    production_id: 'prod-A', fingerprint: 'fp-A',
    total_sections: total, sections: sections
  }, extra || {});
}

// ═══════════════════════════════════════════════════════
console.log('\nIs this the same screenplay? (the dangerous question)');
{
  const { api } = load();
  const a = 'FADE IN:\n\nINT. MARKET - DAY\n\nAdahunse walks through the stalls.\n'.repeat(40);
  const b = 'FADE IN:\n\nINT. CHURCH - NIGHT\n\nTade kneels at the altar.\n'.repeat(40);

  ok('the same text fingerprints the same', api.fingerprint(a) === api.fingerprint(a));
  ok('a different screenplay fingerprints differently',
     api.fingerprint(a) !== api.fingerprint(b));
  // The case that actually happens: a filmmaker fixes a typo on page 60 and
  // re-uploads. Same length, same opening, one word changed in the middle.
  const edited = a.slice(0, Math.floor(a.length / 2)) + 'Z' + a.slice(Math.floor(a.length / 2) + 1);
  ok('an edit in the MIDDLE changes the fingerprint',
     api.fingerprint(a) !== api.fingerprint(edited),
     'a mid-script edit must never resume');
  // A rewrite of the last page is the other real case — a new ending.
  const tail = a.slice(0, -200) + 'INT. HOSPITAL - NIGHT\nShe does not wake up.\n'.padEnd(200, ' ');
  ok('a rewritten ending changes the fingerprint',
     api.fingerprint(a) !== api.fingerprint(tail));
  ok('an empty script has no fingerprint', api.fingerprint('') === '');
  ok('  ...so an empty script can never match a stored one',
     api.fingerprint('') !== api.fingerprint(a));
}

// ═══════════════════════════════════════════════════════
console.log('\nWhere does a resumed run start?');
{
  const { api } = load();
  ok('3 of 6 done -> starts at section 4 (index 3)',
     api.next(rec(6, [0, 1, 2])) === 3);
  ok('nothing done -> starts at the beginning',
     api.next(rec(6, [])) === 0);
  ok('all 6 done -> index 6, past the end',
     api.next(rec(6, [0, 1, 2, 3, 4, 5])) === 6);
  // A gap must be filled, not skipped. Sections finish in order today, so a
  // gap should not happen — but if one ever does, skipping it drops a stretch
  // of film out of the middle of the breakdown, and nobody notices until a
  // scene is missing on set.
  ok('a GAP restarts at the gap, not after it',
     api.next(rec(6, [0, 1, 3, 4])) === 2,
     'must not skip a missing section');
  ok('counts only the sections actually stored',
     api.done(rec(6, [0, 1, 3])) === 3);
  ok('an absent record counts as nothing done', api.done(null) === 0);
  ok('  ...and starts at the beginning', api.next(null) === 0);
}

// ═══════════════════════════════════════════════════════
console.log('\nRebuilt sections stay in the order of the film');
{
  const { api } = load();
  // mergeBreakdownChunks walks the array and numbers scenes against a
  // running offset, so this array's order IS the order of the film. The
  // record is an object, and object key order is not something to rely on.
  const r = rec(6, [2, 0, 1]);   // stored out of order on purpose
  const got = api.chunks(r, 3).map(c => c.scenes[0].scene_number);
  ok('rebuilt in index order, not the order they were stored',
     JSON.stringify(got) === JSON.stringify(['1', '2', '3']), JSON.stringify(got));
  ok('stops at the first gap rather than closing it up',
     api.chunks(rec(6, [0, 1, 3, 4]), 6).length === 2,
     'returned ' + api.chunks(rec(6, [0, 1, 3, 4]), 6).length);
}

// ═══════════════════════════════════════════════════════
console.log('\nWriting and reading the resume point');
{
  const { api, raw } = load();
  const r = rec(4, [0, 1], { script_text: 'FADE IN: a short script' });
  ok('a record writes', api.write(r) === true);
  ok('  ...under one key, so there is only ever one', Object.keys(raw).length === 1);
  const back = api.read();
  ok('it reads back with its sections', back && api.done(back) === 2);
  ok('  ...and its screenplay', back && back.script_text === 'FADE IN: a short script');
  api.clear();
  ok('clearing leaves nothing behind', api.read() === null && Object.keys(raw).length === 0);
}

// ═══════════════════════════════════════════════════════
console.log('\nA damaged or foreign record is refused, not trusted');
{
  const { api, store } = load();
  const bad = [
    ['not JSON at all', 'half a record{'],
    ['no production id', JSON.stringify({ fingerprint: 'f', total_sections: 2, sections: {} })],
    ['no fingerprint', JSON.stringify({ production_id: 'p', total_sections: 2, sections: {} })],
    ['no section count', JSON.stringify({ production_id: 'p', fingerprint: 'f', sections: {} })],
    ['sections is not an object', JSON.stringify({ production_id: 'p', fingerprint: 'f', total_sections: 2, sections: 'nope' })],
    ['null', 'null']
  ];
  bad.forEach(([what, raw]) => {
    store.setItem('slate_resume', raw);
    ok(what + ' -> refused', api.read() === null);
  });
}

// ═══════════════════════════════════════════════════════
console.log('\nNo room on the phone: the run must still finish');
{
  // An old Android browser with a small allowance. The screenplay is the
  // big item, so it goes first — the sections are what cannot be recreated.
  const big = 'FADE IN: ' + 'x'.repeat(4000);
  const { api } = load(2000);          // refuses anything over 2KB
  const r = rec(4, [0], { script_text: big });
  const wrote = api.write(r);
  ok('a record too big to store drops the screenplay and keeps the sections',
     wrote === true);
  const back = api.read();
  ok('  ...so the finished sections survive', back && api.done(back) === 1);
  ok('  ...without the screenplay', back && !back.script_text);
  ok('  ...and the record it was handed is left intact for this run',
     r.script_text === big, 'the live run still has the script in memory');
}
{
  // Nothing at all will store. Returning false is how the run stops trying
  // rather than filling the console on every section of a long screenplay.
  const { api } = load(10);
  ok('when nothing can be stored, the write reports failure',
     api.write(rec(4, [0])) === false);
  ok('  ...and reading finds nothing, rather than something half-written',
     api.read() === null);
}

// ═══════════════════════════════════════════════════════
// Invariants that live in the run itself. Asserted against the source
// because exercising them needs the whole breakdown loop; each one is a
// way a filmmaker gets charged twice or shoots the wrong film.
console.log('\nThe run itself');
const runSrc = block('async function runWorkspaceBreakdown');

ok('the run accepts a resume record',
   /async function runWorkspaceBreakdown\(user, resumeRec\)/.test(runSrc));
ok('a resume REUSES the production id',
   /var productionId = \(resumeRec && resumeRec\.production_id\) \|\|/.test(runSrc),
   'a new id would charge a second credit on the last section');
ok('a fingerprint mismatch throws the record away instead of resuming',
   /resumeRec\.fingerprint !== slateFingerprint[\s\S]{0,300}?slateClearResume\(\)[\s\S]{0,80}?resumeRec = null/.test(runSrc),
   'this is the half-of-one-film-half-of-another bug');
ok('a different section count throws the record away too',
   /resumeRec\.total_sections !== totalChunks[\s\S]{0,300}?slateClearResume\(\)[\s\S]{0,80}?resumeRec = null/.test(runSrc));
ok('the loop starts at the resumed section, not at zero',
   /for \(let i = slateStartAt; i < totalChunks; i\+\+\)/.test(runSrc));
ok('the recovered sections are loaded into completedChunks',
   /completedChunks = slateResumeChunks\(slateResume, slateStartAt\)/.test(runSrc));
ok('a reloaded page can take the screenplay back off the record',
   /resumeRec && resumeRec\.script_text[\s\S]{0,120}?extractedScriptText = resumeRec\.script_text/.test(runSrc));

// Order matters: the section is written down BEFORE the merge and the
// render, either of which can throw, and before the next request, which
// can be cut off.
const pushAt  = runSrc.indexOf('completedChunks.push(result)');
// The write AFTER the push. There are two in the loop — the failure branch
// also records where it stopped, and that one sits earlier in the source.
const writeAt = runSrc.indexOf('slateCanStore = slateWriteResume(slateResume)', pushAt);
const mergeAt = runSrc.indexOf('var soFar = mergeBreakdownChunks(completedChunks)');
ok('the section is stored immediately after it lands', pushAt > 0 && writeAt > pushAt);
ok('  ...and BEFORE the merge and render, which can throw',
   mergeAt > writeAt, 'write at ' + writeAt + ', merge at ' + mergeAt);
ok('stored RAW and by index, not merged',
   /slateResume\.sections\[String\(i\)\] = result/.test(runSrc),
   'a merged document cannot be taken apart and resumed from');

ok('a partial failure KEEPS the resume point',
   /partialFailure = \{[\s\S]{0,400}?slateResume\.failed_section = i \+ 1/.test(runSrc) &&
   !/partialFailure = \{[\s\S]{0,400}?slateClearResume/.test(runSrc),
   'clearing here is what loses the work');
ok('a finished breakdown clears it',
   /if \(!partialFailure\)[\s\S]{0,400}?slateClearResume\(\)/.test(runSrc));

// The money. The credit is charged on the last section and recorded against
// the production id, which is why resuming with the SAME id cannot charge
// twice — and why a run that failed before the last section was never
// charged at all.
const BD = fs.readFileSync(__p.join(ROOT, 'netlify', 'functions', 'breakdown.js'), 'utf8');
console.log('\nThe credit, which is the part that cannot go wrong');
ok('still charged on the last section only',
   /if \(isLastChunk && user && !isAdmin\)/.test(BD));
ok('still guarded by charged_at against a second charge',
   /charged_at/.test(BD) && /alreadyCharged = true/.test(BD));
ok('the guard looks the charge up BY PRODUCTION ID',
   /\.eq\('production_id', production_id\)/.test(BD),
   'this is what the reused id relies on');

// What the filmmaker is actually offered.
console.log('\nWhat the filmmaker sees');
const offerSrc = block('function slateRenderResumeOffer');
ok('the offer names the section it will continue from',
   /Continue from section ' \+ next/.test(offerSrc));
ok('  ...and says no extra credit is taken', /No extra credit/.test(offerSrc));
ok('  ...and says where the sections are kept',
   /saved on this device/.test(offerSrc));
ok('no screenplay stored -> asks for the same file instead of giving up',
   /Upload the same screenplay below/.test(offerSrc));
ok('discarding the work asks first, because nothing else is holding it',
   /window\.confirm\([\s\S]{0,200}?cannot be undone/.test(offerSrc));
ok('the offer is hidden when there is nothing to resume',
   /if \(!rec \|\| !done\) \{ el\.style\.display = 'none'/.test(offerSrc));

const partialBanner = APP.slice(APP.indexOf('if (partial) {'), APP.indexOf('if (partial) {') + 1600);
ok('the failure banner offers to continue rather than to retry everything',
   /wsResumeBtn[\s\S]{0,200}?Continue from section/.test(partialBanner));
ok('  ...at 44px, the size a thumb can hit', /min-height:44px/.test(partialBanner));
ok('  ...and says nothing is processed twice',
   /not processed again/.test(partialBanner));

// The uploader has to find the record on its own, because a filmmaker who
// comes back the next day uploads the file rather than pressing Continue.
const btnSrc = APP.slice(APP.indexOf("generateBtn.addEventListener('click'"),
                         APP.indexOf("generateBtn.addEventListener('click'") + 1400);
ok('pressing Start on the same screenplay picks up the resume point',
   /rec\.fingerprint === slateScriptFingerprint\(extractedScriptText\)/.test(btnSrc));
ok('  ...only when something was actually finished',
   /slateResumeDoneCount\(rec\) > 0/.test(btnSrc));
ok('  ...and a failure to read it never blocks a new breakdown',
   /catch \(e\) \{\}[\s\S]{0,80}runWorkspaceBreakdown\(user, slateRec\)/.test(btnSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
