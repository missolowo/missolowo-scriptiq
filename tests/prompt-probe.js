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

// ══════════════════════════════════════════════
// The nine roll-ups. Each is "this element across all the scenes", and the
// model was writing every element twice: once on its scene, once in the
// roll-up. Now collected from the scenes after the merge.
//
// The pairing below is the point. A derived list is only as good as the
// per-scene field it is collected from — so for every all_* we check BOTH
// that we stopped asking for it AND that its source still exists on the
// scene schema. Drop `props` from the scene and ALL PROPS silently becomes
// an empty list on every document a buyer works from.
console.log('\nEvery roll-up is collected from a field we still ask for');
const ROLLUPS = [
  ['all_props', 'props'],
  ['all_costume', 'costume'],
  ['all_equipment', 'equipment'],
  ['all_stunts', 'stunts'],
  ['all_vehicles', 'vehicles'],
  ['all_animals', 'animals'],
  ['all_special_effects', 'special_effects'],
  ['all_makeup_hair', 'makeup_hair']
];
ROLLUPS.forEach(([rollup, field]) => {
  ok(rollup + ' is no longer requested', !new RegExp('"' + rollup + '"').test(SCHEMA));
  ok('  ...its source "' + field + '" is still on every scene',
     new RegExp('"' + field + '":').test(SCHEMA),
     'without this the derived list is silently empty');
  ok('  ...and it is collected from exactly that field',
     new RegExp('all_' + field.replace(/_/g, '_') + '\\s*=\\s*slateCollectElement\\(\'' + field + '\'\\)')
       .test(mergeSrc) ||
     new RegExp(rollup + '\\s*=\\s*slateCollectElement\\(\'' + field + '\'\\)').test(mergeSrc));
});

console.log('\nCast is taken from Report 2, so the two cannot disagree');
ok('all_cast comes from the character breakdown',
   /all_cast\s*=\s*\(merged\.character_breakdown \|\| \[\]\)\.map/.test(mergeSrc),
   'not re-derived separately, or the elements list and Report 2 can drift');
ok('all_cast is NOT requested from the model', !/"all_cast"/.test(SCHEMA));

console.log('\nWhat we still DO ask for, deliberately');
// special_requirements is the one element list with no per-scene source.
// It is the model's reading of what a section needs beyond the items it
// listed, so there is nothing to collect it from.
ok('special_requirements is still requested', /"special_requirements"/.test(SCHEMA));
ok('  ...and the merge still reads it from each section',
   /merged\.production_elements\.special_requirements = slateMergeElements/.test(mergeSrc));
ok('  ...and nothing tries to derive it', !/slateCollectElement\('special_requirements'\)/.test(mergeSrc));

console.log('\nThe dials that decide how much a section writes');
ok('at most 4 scenes per section', /SLATE_MAX_SCENES_PER_CHUNK = 4\b/.test(APP),
   'output tracks scene count, which is what pushes a section past the gateway');
ok('the rate limit allows a feature screenplay in one sitting',
   /'breakdown', 80,/.test(BD),
   'one section is one request; 20 could not finish one film');
ok('  ...and the scene cap is still enforced in the splitter',
   /SLATE_MAX_SCENES_PER_CHUNK/.test(APP.replace(/SLATE_MAX_SCENES_PER_CHUNK = 4/, '')));

// ══════════════════════════════════════════════════
// A TRANSITION IS NOT A SCENE.
//
// "CUT TO:" came back from the model as a scene with no location and no
// time. The scene-boundary rules were strict about mood changes and long
// scenes and said nothing at all about transitions, which sit alone on a
// line and look structural. Same for an episode title: HILLS is a
// four-episode series, and "EPISODE TWO — THE RAIN" sits between slug
// lines exactly where a heading would.
// The whole prompt, not a window into it.
//
// SCHEMA and RULES above cover the JSON shape and a short trailing line.
// They do NOT cover the instruction body, which sits BEFORE the schema in
// the file — "RULES:" turns out to be 55 characters from the end of the
// template literal, so every actual rule the model is given was outside
// anything this probe read. The scene-boundary rules, the location rules,
// the background rules and the department rules were all unasserted.
const PROMPT = (() => {
  const end = BD.indexOf('`;', BD.indexOf('RULES:'));
  const open = BD.lastIndexOf('`', BD.indexOf('SCENE BOUNDARIES'));
  return (open >= 0 && end > open) ? BD.slice(open, end) : '';
})();

console.log('\nThe probe can see the instructions at all');
ok('the prompt body is in view', PROMPT.length > 4000,
   PROMPT.length + ' characters — a window that misses the rules asserts nothing');
ok('  ...and it holds the scene-boundary rules',
   /SCENE BOUNDARIES/.test(PROMPT) && /BACKGROUND ACTORS/.test(PROMPT));

console.log('\nTransitions and act breaks are named as non-scenes');
{
  ok('the prompt says a transition is not a scene',
     /TRANSITION IS NOT A SCENE/.test(PROMPT), 'nothing tells the model this');
  ['CUT TO:', 'DISSOLVE TO:', 'FADE OUT.', 'MATCH CUT TO:', 'BACK TO:']
    .forEach(function (t) {
      ok('  ...and names "' + t + '"', PROMPT.indexOf(t) >= 0);
    });
  ok('an episode title is named too, because a series script has them',
     /EPISODE TWO/.test(PROMPT) && /is not a scene either/.test(PROMPT));
}

// ══════════════════════════════════════════════════
// BACKGROUND IS DECIDED BY DIALOGUE, NOT BY NAMING.
//
// A producer told us his breakdown "missed the listed BG people". His
// script returned background on 4 of 117 scenes, and his cast list held
// DRIVER, RECEPTIONIST #1 and RECEPTIONIST #2 — functional roles with no
// character name. HILLS had eight of them: VILLAGER, MARKET WOMAN,
// POLICE OFFICER, ELDERLY MAN, YOUNG MAN, BOY, GIRL, DOCTOR.
//
// The rule said "named characters with dialogue are cast, not
// background" and was silent on the opposite case, while every example
// of background was a plural crowd. A single unnamed person had nowhere
// to go but cast — where they are auditioned instead of booked, and
// where they make the background count read as zero.
console.log('\nBackground is decided by dialogue, not by naming');
{
  ok('the test is stated as dialogue',
     /THE TEST IS DIALOGUE, NOT NAMING/.test(PROMPT), 'the old rule keyed on naming');
  ok('a speaking bit part is still cast, however labelled',
     /RECEPTIONIST #1[^\n]*is cast/.test(PROMPT),
     'without this the fix loses speaking roles from the cast list, which is worse');
  ok('one person counts, not only a crowd',
     /ONE PERSON COUNTS/.test(PROMPT));
  ok('  ...and the singular examples are there',
     /A WAITER/.test(PROMPT) && /THE DRIVER/.test(PROMPT) && /A NURSE/.test(PROMPT),
     'every example used to be plural, which is what biased the model to crowds');
  ok('an unnamed non-speaking role is told to go in background and NOT cast',
     /goes in "background" and NOT in "cast"/.test(PROMPT));
  ok('and invention is still forbidden',
     /Never populate a scene the writer left empty/.test(PROMPT),
     'a prompt that asks for more background must not license inventing it');
  ok('  ...and estimating a count still is',
     /NEVER estimate a number/.test(PROMPT));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
