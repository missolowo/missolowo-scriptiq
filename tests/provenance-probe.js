// Which run produced this document.
//
//   node tests/provenance-probe.js
//
// WHY THIS FILE EXISTS
//
// On 23 November Elizabeth asked why scene 4 was missing from a call
// sheet. It was not missing from the breakdown. The call sheet had been
// built against production 255efb47 — the 18:27 five-scene run — while
// the schedule beside it had been built from 7997e45b. Two runs of the
// same screenplay, two documents, and nothing on either page said which
// was which.
//
// That is the worst failure mode this product has, and the reason is not
// the mix-up. It is that the mix-up is SILENT. A stale call sheet looks
// exactly like a current one: same title, same branding, same day number,
// plausible scenes. The only way it was caught was a human who knew the
// script well enough to miss a scene by eye. On a unit that does not have
// Elizabeth reading it, that call sheet goes out.
//
// WHAT IS ASSERTED HERE
//
// 1. A stamp is minted once per completed run, and ONLY there — a
//    reopened production keeps the stamp it was saved with.
// 2. It survives a save without a database change. This is a constraint,
//    not a preference: a new column on the breakdowns table is Elizabeth's
//    to approve. So the stamp lives in production_elements, which save.js
//    already stores and load.js already returns verbatim.
// 3. It is lifted onto the top level at BOTH boundaries, so no renderer
//    has to know where it is kept.
// 4. It prints on every page of all three documents.
// 5. The call sheet REFUSES a schedule from another run — and does not
//    refuse when either id is simply absent, which is every production
//    saved before today.
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const SCHED = fs.readFileSync(__p.join(ROOT, 'netlify/functions/schedule.js'), 'utf8');
const CS = fs.readFileSync(__p.join(ROOT, 'netlify/functions/callsheet.js'), 'utf8');
const SAVE = fs.readFileSync(__p.join(ROOT, 'netlify/functions/save.js'), 'utf8');
const LOAD = fs.readFileSync(__p.join(ROOT, 'netlify/functions/load.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(src, needle) {
  const s = src.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  return src.slice(s, end);
}

const api = new Function(
  block(APP, 'function slateRunStamp') + '\n'
  + block(APP, 'function slateAdoptRunStamp') + '\n'
  + '; return { stamp: slateRunStamp, adopt: slateAdoptRunStamp };')();
const { stamp, adopt } = api;

// ══════════════════════════════════════════════════
console.log('\nA stamp a person can compare by eye');
{
  const s = stamp();
  ok('it is six characters', s.length === 6, JSON.stringify(s));
  ok('lowercase hex only', /^[0-9a-f]{6}$/.test(s), JSON.stringify(s)
     + ' — it is read off a printed footer, possibly down a phone');

  // The actual requirement: two stamps must differ. A collision prints two
  // different runs under one name, which is worse than no stamp at all
  // because it would be trusted.
  const seen = {};
  let collisions = 0;
  for (let i = 0; i < 4000; i++) {
    const v = stamp();
    if (seen[v]) collisions++;
    seen[v] = true;
  }
  ok('4000 stamps in a tight loop collide rarely', collisions < 40,
     collisions + ' collisions — two runs sharing a name is worse than none');

  // The first version spent three of the six characters on the clock so
  // that stamps would sort. That cost 12 bits of the 24 and collided
  // 1,415 times in the loop above — on precisely the case the stamp
  // exists for, two runs of one script minutes apart. Order was never the
  // requirement; slate_run_at and slate_built_at carry real timestamps.
  ok('no part of the stamp is spent on the clock',
     !/Date\.now\(\)/.test(block(APP, 'function slateRunStamp')),
     'every character given to ordering is a character not telling two '
     + 'runs apart, and nobody decodes a hex prefix anyway');
  ok('  ...and the timestamps that DO order them are carried instead',
     /slate_run_at/.test(APP) && /slate_built_at:/.test(CS));
}

// ══════════════════════════════════════════════════
console.log('\nStamped once, at the one moment a run completes');
{
  const mint = APP.indexOf('production_elements.slate_run = {');
  ok('the stamp is minted in exactly one place',
     (APP.match(/production_elements\.slate_run\s*=\s*\{/g) || []).length === 1,
     (APP.match(/production_elements\.slate_run\s*=\s*\{/g) || []).length + ' places');

  // It must be minted AFTER the merge, on the assembled breakdown — the
  // server only ever sees one section at a time, so no section can stamp
  // the whole.
  ok('  ...after the sections are merged',
     mint > APP.indexOf('slateBreakdown = mergeBreakdownChunks('),
     'a section cannot name the run that assembled it');

  // And the restore path must NOT re-stamp. A production reopened next
  // week has to keep the stamp of the run that made its documents,
  // otherwise the footer dates the reading rather than the run and the
  // whole thing is decorative.
  const restore = block(APP, 'window.slateRestoreProduction = function');
  ok('reopening a production does not re-stamp it',
     !/slate_run\s*=\s*\{/.test(restore) && !/slateRunStamp\(/.test(restore),
     'the stamp names the run that produced the documents, not the day '
     + 'somebody looked at them again');
  ok('  ...it adopts the stored stamp instead',
     /slateAdoptRunStamp\(data\.breakdown\)/.test(APP));
}

// ══════════════════════════════════════════════════
// THE CONSTRAINT.
console.log('\nIt survives a save with no database change');
{
  // production_elements is an existing JSON column. slate_reading already
  // lives there for exactly this reason. A new column on the breakdowns
  // table is a production database change and is not mine to make.
  ok('the stamp is stored inside production_elements',
     /production_elements\.slate_run/.test(APP),
     'anywhere else needs a new column');
  ok('save.js already persists production_elements verbatim',
     /production_elements:\s*payload\.production_elements/.test(SAVE));
  ok('load.js already returns it verbatim',
     /production_elements:\s*breakdownRow\.production_elements/.test(LOAD));

  // No new columns asked for anywhere.
  ok('no new breakdown column is written',
     !/slate_run_id:\s*payload/.test(SAVE) && !/slate_run_id/.test(SAVE),
     'a schema change needs Elizabeth’s written approval');
  ok('no new breakdown column is read',
     !/slate_run_id/.test(LOAD));

  // The schedule and the call sheet store their whole payload in a JSON
  // column, so theirs persist without any change at all.
  ok('the schedule persists its stamp inside schedule_data',
     /schedule_data:\s*payload/.test(SAVE));
  ok('the call sheet persists its stamp inside sheet_data',
     /sheet_data:\s*payload/.test(SAVE));
}

console.log('\nLifted onto the top level at both boundaries');
{
  ok('adopting a breakdown with a stamp exposes it',
     adopt({ production_elements: { slate_run: { id: 'a1b2c3', at: 'T', fingerprint: 'f' } } })
       .slate_run_id === 'a1b2c3');
  ok('  ...with the time and the fingerprint',
     adopt({ production_elements: { slate_run: { id: 'a1b2c3', at: 'T', fingerprint: 'f' } } })
       .slate_run_at === 'T');

  // Every production saved before today. These must come back as empty
  // strings, which every consumer treats as unknown.
  ok('a breakdown with no production_elements adopts an empty id',
     adopt({}).slate_run_id === '');
  ok('a breakdown with no stamp adopts an empty id',
     adopt({ production_elements: {} }).slate_run_id === '');
  ok('null does not throw', adopt(null) === null);

  ok('the fresh-run boundary adopts',
     /slateAdoptRunStamp\(slateBreakdown\)/.test(APP));
  ok('the load boundary adopts',
     /slateAdoptRunStamp\(data\.breakdown\)/.test(APP));
}

// ══════════════════════════════════════════════════
console.log('\nIt travels to the other two documents');
{
  ok('the schedule echoes the breakdown’s run, never mints its own',
     /slate_run_id:\s*breakdown\.slate_run_id/.test(SCHED)
     && !/slateRunStamp/.test(SCHED),
     'a schedule is a reading of one breakdown and has no identity of its own');
  ok('the call sheet echoes it too',
     /slate_run_id:\s*slateBdRun/.test(CS) && !/slateRunStamp/.test(CS));
  ok('  ...and records when this particular sheet was built',
     /slate_built_at:/.test(CS),
     'a day 4 sheet rebuilt after a scene moved is a new sheet from the '
     + 'same run, and a crew holding two needs to see which is later');
}

console.log('\nPrinted on every page of all three documents');
{
  ok('slateDoc takes the stamp as an argument',
     /function slateDoc\(documentLabel,\s*documentStamp\)/.test(APP),
     'read from a global, a document could be stamped with whatever else '
     + 'happens to be in memory');
  ok('the footer prints it beside the page number',
     /'Page '\s*\+\s*pg\s*\+\s*\(stamp\s*\?\s*'\s*·\s*Run '/.test(APP),
     'a call sheet reaches set as a photograph of one page');

  [['Script Breakdown', /slateDoc\('Script Breakdown',\s*d\.slate_run_id\)/],
   ['Shooting Schedule', /slateDoc\('Shooting Schedule',\s*s\.slate_run_id\)/],
   ['Call Sheet', /slateDoc\('Call Sheet',\s*cs\.slate_run_id\)/]
  ].forEach(function (pair) {
    ok('  the ' + pair[0] + ' passes its own run', pair[1].test(APP),
       'one document without it is one document that cannot be identified');
  });

  ok('the on-screen call sheet shows it before export',
     /Run '\s*\+\s*slateEscapeHtml\(cs\.slate_run_id\)/.test(APP),
     'checking after the PDF has been sent is too late');

  // A document with NO stamp prints what it always printed. Every saved
  // production predates this change.
  ok('an unstamped document prints no run and no empty label',
     /stamp\s*\?\s*'\s*·\s*Run '\s*\+\s*stamp\s*:\s*''/.test(APP),
     '"Run" followed by nothing reads as a fault');
}

// ══════════════════════════════════════════════════
// THE REFUSAL — the part that actually fixes the bug.
console.log('\nA call sheet refuses a schedule from another run');
{
  const guard = CS.slice(CS.indexOf('const slateBdRun'),
                         CS.indexOf('const targetDay'));
  ok('both ids are compared', /slateBdRun\s*&&\s*slateSchRun/.test(guard));
  ok('  ...and only a real disagreement refuses',
     /slateBdRun\s*!==\s*slateSchRun/.test(guard));
  ok('it refuses with 409, not a silent repair',
     /statusCode:\s*409/.test(guard),
     'there is no correct way to blend two runs: the scene indexes are the '
     + 'identity every cast and element list matches on');
  ok('the error names both runs so they can be told apart',
     /slate_breakdown_run/.test(guard) && /slate_schedule_run/.test(guard));
  ok('  ...and says what to do about it',
     /Regenerate the shooting schedule/.test(guard),
     'an error a filmmaker cannot act on is an error they will work around');

  // The thing that must NOT happen: locking someone out of a film they
  // saved last week, when neither document has a stamp.
  ok('an absent id is unknown, not mismatched',
     guard.indexOf('if (slateBdRun && slateSchRun') > 0,
     'every production saved before today has no stamp on either document, '
     + 'and refusing those would be a worse bug than the one being fixed');

  // The guard has to run BEFORE the day is resolved, or a mismatched run
  // has already been used to pick scenes.
  ok('it runs before the day is looked up',
     CS.indexOf('const slateBdRun') < CS.indexOf('const targetDay'));
}

console.log('\nThe in-session guard catches it too');
{
  const stale = block(APP, 'function slateCallsheetOutOfDate');
  ok('a run mismatch is out of date whatever the scene list says',
     /slate_run_id\s*!==\s*slateSchedule\.slate_run_id/.test(stale),
     'the sheet Elizabeth found agreed day for day and described another run');
  ok('  ...and both ids must be present to disagree',
     /slateCallsheet\.slate_run_id\s*&&\s*slateSchedule\.slate_run_id/.test(stale));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
