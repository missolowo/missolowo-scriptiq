// What we ask the model for, and what we work out ourselves.
//
// Every field in the prompt costs generation time, and generation time is
// what pushes a section past Netlify's gateway. So what we ask for is a
// cost, not a free choice — and asking for something we then discard is
// pure waste paid for on every section of every breakdown.
//
// That is not hypothetical. Reports 2 and 3 were requested from the model
// on every section from launch until 14 November. mergeBreakdownChunks
// rebuilt both from merged.scenes and OVERWROTE the model's answer before
// anything rendered. Nothing ever read what we paid for.
//
// These assertions exist so that stays true. If someone re-adds the ask,
// or changes the merge to trust the model's grouping instead of the
// scenes, this fails loudly.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const BD = fs.readFileSync(__p.join(ROOT, 'netlify', 'functions', 'breakdown.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// The prompt is the part of breakdown.js inside the template literal that
// shows the model its JSON shape. Everything between the scenes array and
// the RULES line is what we are paying the model to write.
const schemaStart = BD.indexOf('"scenes": [');
const rulesStart = BD.indexOf('RULES:');
const SCHEMA = (schemaStart >= 0 && rulesStart > schemaStart)
  ? BD.slice(schemaStart, rulesStart) : '';
// Stop at the end of the template literal, not at an arbitrary character
// count. A fixed window swept up the comment that explains WHY Reports 2
// and 3 are not asked for — and the explanation names them, so the probe
// read our reasoning as the thing it forbids.
const RULES = (() => {
  if (rulesStart < 0) return '';
  const end = BD.indexOf('`;', rulesStart);
  return BD.slice(rulesStart, end > rulesStart ? end : rulesStart + 400);
})();

console.log('\nThe schema we hand the model');
ok('the schema block was found at all', SCHEMA.length > 200, String(SCHEMA.length));
ok('we still ask for the scenes themselves', /"scenes":\s*\[/.test(SCHEMA));
ok('  ...with the cast on each one', /"cast":/.test(SCHEMA));
ok('  ...and the location on each one', /"location":/.test(SCHEMA));

console.log('\nWe do NOT pay for what we overwrite');
ok('Report 2 is not requested', !/"character_breakdown"/.test(SCHEMA),
   'the merge overwrites it from merged.scenes — asking is pure waste');
ok('Report 3 is not requested', !/"outline_schedule"/.test(SCHEMA),
   'same: rebuilt from merged.scenes before anything renders');
ok('  ...and no rule tells it to group scenes by location',
   !/Group ALL scenes by location/i.test(RULES));
ok('  ...or to sort a character breakdown',
   !/character_breakdown/i.test(RULES));
ok('every scene is still required', /Include EVERY scene/i.test(RULES));

console.log('\nBecause we work both out from the scenes');
// The grouping maps must be fed by the scenes, not by anything the model
// returned. This is the assertion that matters: if someone "fixes" the
// reports by trusting the model again, the scenes and the reports can
// disagree, and a character can appear in a scene they are not listed in.
const mergeSrc = (() => {
  const s = APP.indexOf('function mergeBreakdownChunks');
  let d = 0, e = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') d++;
    else if (APP[j] === '}') { d--; if (!d) { e = j + 1; break; } }
  }
  return APP.slice(s, e);
})();

// Wide enough to span the comment between the walk and the assignment.
ok('the character map is built by walking merged.scenes',
   /merged\.scenes\.forEach[\s\S]{0,1200}?charMap\[k\] = \{ character/.test(mergeSrc));
ok('  ...from each scene\'s own cast list',
   /\(s\.cast \|\| \[\]\)\.forEach/.test(mergeSrc));
ok('the location map is built from each scene\'s own location',
   /var loc = String\(s\.location \|\| ''\)\.trim\(\)/.test(mergeSrc));
ok('Report 2 is assigned FROM the character map',
   /merged\.character_breakdown = Object\.keys\(charMap\)/.test(mergeSrc),
   'not merged with the model\'s version — replaced by it');
ok('Report 3 is assigned FROM the location map',
   /merged\.outline_schedule = Object\.keys\(locMap\)/.test(mergeSrc));

console.log('\nThe derived reports still carry what the documents need');
ok('cast numbers are assigned', /c\.cast_number = i \+ 1/.test(mergeSrc),
   'the key the stripboard, Day Out of Days and call sheet all join on');
ok('  ...ordered by scene count, so the lead is number one',
   /if \(b\.total !== a\.total\) return b\.total - a\.total/.test(mergeSrc));
ok('scenes with no location still appear, flagged',
   /SLATE_NO_LOCATION_KEY/.test(mergeSrc) && /no_location: noLoc/.test(mergeSrc),
   'seventeen scenes once vanished from a 47-scene report this way');

console.log('\nThe dead dedupe is gone');
ok('nothing dedupes a report the model no longer sends',
   !/chunk\.character_breakdown = slateDedupe/.test(APP) &&
   !/chunk\.outline_schedule = slateDedupe/.test(APP));
ok('  ...but slateDedupe itself still exists for the production elements',
   /function slateDedupe/.test(APP));

console.log('\nWhat we still DO ask for, deliberately');
// production_elements is derivable too — every all_* array has a per-scene
// source. It is still requested because, unlike Reports 2 and 3, the merge
// genuinely uses what comes back. Changing that is a separate decision with
// a real quality question attached, not a free win.
ok('production elements are still requested', /"production_elements"/.test(SCHEMA));
ok('  ...and the merge genuinely reads them',
   /chunk\.production_elements/.test(APP),
   'this is the difference between this and Reports 2 and 3');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
