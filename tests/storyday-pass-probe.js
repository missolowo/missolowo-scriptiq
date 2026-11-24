// The story-day pass: inference, contained.
//
//   node tests/storyday-pass-probe.js
//
// WHY THIS FILE EXISTS
//
// This is the first place in Missolowo Slate where we INFER rather than
// read. Every other field on a breakdown is on the filmmaker's page —
// scene numbers, locations, INT/EXT, times of day, props — and "ask the
// page, don't extend the vocabulary" is the rule that has kept this
// product honest through three wrong fixes and two prompt regressions.
//
// A story day is almost never written down. The first live run, 24
// November, came back with story_day empty on all six scenes of THE
// WEAVER'S DAUGHTER, because that script — like most screenplays and
// nearly every Nollywood one — does not mark them. The prompt was asking
// a question almost no script answers.
//
// So the design is not about inferring well. It is about CONTAINING
// inference, and that is what these assertions cover:
//
//   1. The pass cannot touch the breakdown prompt. It is a separate
//      function, and nothing in it can reach the reading.
//   2. It writes ONE field. It cannot add, remove or reorder a scene, so
//      row conservation needs no guard — there is nothing to violate.
//   3. The writer's own mark always wins.
//   4. "I do not know" is a first-class answer, and a wrong story day is
//      worse than no story day: it tells a wardrobe supervisor two scenes
//      must match when they must not, and they will plan around it.
//   5. Every failure leaves the breakdown exactly as it was. The pass is
//      free, so a failure costs a filmmaker nothing.
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const FN = fs.readFileSync(__p.join(ROOT, 'netlify/functions/storyday.js'), 'utf8');
const BD = fs.readFileSync(__p.join(ROOT, 'netlify/functions/breakdown.js'), 'utf8');

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

// ══════════════════════════════════════════════════
// 1. IT CANNOT REACH THE READING.
console.log('\nIt is a separate function, and cannot touch the breakdown prompt');
{
  ok('the pass lives in its own function file',
     fs.existsSync(__p.join(ROOT, 'netlify/functions/storyday.js')));
  ok('the breakdown prompt is unchanged by it',
     !/worked out|infer the story day|narrative/i.test(BD.slice(BD.indexOf('HEADING METADATA'),
       BD.indexOf('LOCATION vs SET'))),
     'the reading took three wrong fixes and five screenplays to get right, '
     + 'and both regressions of 23 November came from editing this prompt');
  ok('the pass does not read or send the screenplay',
     !/script_text|extractedScriptText/.test(FN),
     'a one-line description is enough to tell "the next morning" from '
     + '"moments later", and sending the screenplay is a promise we do not '
     + 'need to make');
}

// ══════════════════════════════════════════════════
// 2. IT WRITES ONE FIELD.
console.log('\nIt can only write story_day, and only by scene_index');
{
  const caller = block(APP, 'async function slateInferStoryDays');

  ok('answers are matched to scenes by scene_index',
     /byIndex\[Number\(r && r\.index\)\]/.test(caller),
     'an answer about a scene we did not send is dropped, not questioned');
  ok('  ...and an answer about an unknown scene is dropped',
     /if \(!s\) return;/.test(caller));

  // The structural guarantee. Row conservation has a guard everywhere else
  // in this product; here it needs none, because the pass has no power to
  // change rows at all.
  const writes = (caller.match(/\bs\.[a-z_]+\s*=/g) || []);
  ok('it assigns exactly two fields on a scene, and no others',
     writes.length === 2
     && writes.join(' ').includes('s.story_day =')
     && writes.join(' ').includes('s.story_day_inferred ='),
     JSON.stringify(writes) + ' — a pass that cannot change rows cannot '
     + 'break row conservation');
  ok('nothing in the pass can add or remove a scene',
     !/\.push\(|\.splice\(|scenes\s*=/.test(caller),
     'the model answers ABOUT scenes; it does not decide which exist');

  // The value is compared for equality across scenes, so it goes through
  // the one reader rather than being trusted as it arrives.
  ok('the answer is normalised through the one reader',
     /slateStoryDay\(r\.day\)/.test(caller),
     'this field is compared for equality, so a value that does not '
     + 'compare cleanly is worse than an absent one');
}

console.log('\nThe writer’s own mark always wins');
{
  const caller = block(APP, 'async function slateInferStoryDays');
  ok('a scene that already has a story day is left alone',
     /if \(String\(s\.story_day \|\| ''\)\.trim\(\)\) return;/.test(caller),
     'if the writer went to the trouble, ours is not an improvement');

  // And a script that marks enough of them does not call the model at all.
  ok('a script that states its own days skips the pass entirely',
     /script_states_its_own/.test(FN) && /SLATE_STATED_MIN/.test(FN),
     'no call, no latency, no cost');
  ok('  ...on the same test the scene numbers use',
     /stated >= SLATE_STATED_MIN && stated >= scenes\.length \* SLATE_STATED_SHARE/.test(FN),
     'a handful of marks is a writer being inconsistent; a fifth of the '
     + 'script is a writer with a convention');
}

// ══════════════════════════════════════════════════
// 3. UNKNOWN IS A FIRST-CLASS ANSWER.
console.log('\n"I do not know" is correct, and is made cheap to say');
{
  ok('the prompt says so in as many words',
     /"I DO NOT KNOW" IS A CORRECT ANSWER, AND IT IS FREE/.test(FN));
  ok('  ...and says why, in the reader’s own terms',
     /wardrobe supervisor that two scenes must match when they must not/.test(FN),
     'a rule without its reason is a rule the model trades away');
  ok('  ...and forbids guessing to fill the list',
     /Never guess to fill the list/.test(FN));

  // The three cases that must come back null, each of which would
  // otherwise produce a confident wrong grouping.
  ok('a time-spanning montage is null, not day 1',
     /montage or sequence that spans more than one day/.test(FN));
  ok('a flashback is never given the story day of its neighbours',
     /a flashback between scene 6 and scene 7 is not story day 7/.test(FN),
     'a flashback is in another time entirely');
  ok('a scene with nothing to go on is null',
     /any scene where the script gives you nothing to go on/.test(FN));
}

console.log('\nOnly a clean day number is accepted back');
{
  // Slice from the containment block to the end of the forEach that holds
  // it, rather than guessing at the whitespace of a later line.
  const guard = FN.slice(FN.indexOf('const seen = {};'),
                         FN.indexOf('scenes_in: scenes.length'));
  ok('a non-numeric day is dropped', /!isFinite\(d\)/.test(guard));
  ok('zero and negatives are dropped', /d < 1/.test(guard));
  ok('a fraction is dropped', /Math\.floor\(d\) !== d/.test(guard));
  ok('a duplicate answer for one scene is dropped', /seen\[i\]/.test(guard));
  ok('an answer about a scene we never sent is dropped', /!known\[i\]/.test(guard));
}

// ══════════════════════════════════════════════════
// 4. EVERY FAILURE IS SAFE.
console.log('\nEvery way this can fail leaves the breakdown as it was');
{
  ok('a model failure returns 200 with no days',
     /model_unavailable/.test(FN) && /statusCode: 200/.test(FN),
     'a free pass must not be able to look like a broken breakdown');
  ok('an unreadable answer returns no days',
     /unreadable_response/.test(FN));
  ok('a thrown error returns no days',
     /failed: 'error'/.test(FN));

  const caller = block(APP, 'async function slateInferStoryDays');
  ok('the caller survives a non-ok response',
     /if \(!res\.ok\) return bd;/.test(caller));
  ok('  ...and anything thrown', /catch \(e\) \{/.test(caller));
  ok('  ...and says nothing to the filmmaker about it',
     !/alert\(|showError|slateToast/.test(caller),
     'their breakdown is complete and correct without this; an error about '
     + 'a free pass they did not ask for would only worry them');
  ok('  ...and an empty or missing scene list is a no-op',
     /if \(!bd \|\| !Array\.isArray\(bd\.scenes\) \|\| !bd\.scenes\.length\) return bd;/.test(caller));
}

console.log('\nIt runs where it has to, and before the save');
{
  const merge = APP.indexOf('slateAdoptRunStamp(slateBreakdown);');
  const call = APP.indexOf('await slateInferStoryDays(slateBreakdown);');
  const save = APP.indexOf("await slateSave('breakdown'");

  ok('after the merge', call > merge,
     'the breakdown reads in four-scene chunks, and a chunk cannot know '
     + 'that scene 40 is a year after scene 39 unless it sees both');
  ok('before the save', call < save,
     'a filmmaker who comes back next week must find the days still there');
}

// ══════════════════════════════════════════════════
// 5. THE DOCUMENTS SAY WHOSE JUDGEMENT IT IS.
console.log('\nA script supervisor can tell our reading from the writer’s');
{
  const prov = new Function(block(APP, 'function slateStoryDayProvenance')
    + '; return slateStoryDayProvenance;')();

  ok('all inferred is reported as all inferred',
     prov([{ story_day: '1', story_day_inferred: true },
           { story_day: '2', story_day_inferred: true }]).all_inferred === true);
  ok('all stated is not flagged at all',
     prov([{ story_day: '1' }, { story_day: '2' }]).inferred === 0);
  ok('a mixed script is reported as mixed',
     prov([{ story_day: '1', story_day_inferred: true },
           { story_day: '2' }]).mixed === true,
     'the only case where naming individual scenes would help');
  ok('scenes with no story day count as neither',
     prov([{ story_day: '' }, {}, null]).inferred === 0);

  ok('the breakdown says it on screen',
     /worked out by Slate\s*'\s*\n?\s*\+\s*'from the narrative|worked out by Slate from/.test(APP));
  ok('  ...and in the PDF', /slatePdfProv\.inferred/.test(APP));
  // The call sheet never shows Report 5, so if it is not said there it is
  // not said anywhere a unit will actually read it.
  ok('  ...and on the call sheet, which never shows Report 5',
     /Story days were worked out by Slate from the narrative rather than marked in/.test(APP));
  ok('  ...and tells them what to do about it',
     /Worth a check before wardrobe plans around them/.test(APP),
     'naming a judgement without saying it is checkable is just a disclaimer');
}

console.log('\nThe first run reports on itself');
{
  const caller = block(APP, 'async function slateInferStoryDays');
  ['story_days_inferred', 'story_days_unknown', 'story_days_skipped',
   'distinct_story_days'].forEach(function (k) {
    ok('  ' + k + ' is recorded', caller.indexOf(k) > 0,
       'the failure here is quiet wrongness, which only a real script shows');
  });
  ok('distinct is counted, not just coverage',
     /distinct_story_days = \(function/.test(caller),
     'a script where every scene comes back day 1 is present everywhere and '
     + 'discriminates nothing, and that looks identical to a good result if '
     + 'you only count coverage');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
