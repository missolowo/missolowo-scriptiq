// Matching the model's scenes to the script's own headings.
//
//   node tests/align-probe.js
//
// WHY THIS FILE EXISTS
//
// On 19 November a producer sent us this, about a script whose every scene
// he had numbered himself:
//
//   "It's telling me my script is missing scene numbers so it gave it its
//    own scene numbers. ... It also skipped a lot of my number scenes. The
//    numbering being off threw everything else off."
//
// Both halves were us. We read 74 of his numbers off the page correctly —
// and then printed only 40 of them, because the merge paired the model's
// scenes with our headings BY POSITION. Scene seven's number went to the
// model's seventh scene. That holds exactly as long as the two lists are
// the same length, and they are not: the model splits a scene we read as
// one and merges two we read as one. One such disagreement anywhere near
// the front shifts every number after it, and a shifted number is worse
// than no number — it is a wrong number, printed with confidence, on a
// document somebody schedules a shoot from.
//
// So the merge stopped counting and started matching, on the one thing the
// two lists genuinely share: the location. The model rewrites a slug line
// but it does not invent the place.
//
// THE CASE THAT DECIDES THE DESIGN is "a gap in the middle", below. The
// first implementation walked both lists forward greedily. It matched the
// opening seventeen scenes of a real screenplay perfectly, then collapsed —
// once a run of scenes failed, the cursor stalled while the model's list
// ran on, and every true match after that drifted out of reach. 45 of 107.
// A greedy walk cannot recover from a gap. Gaps are the normal case. That
// is why this is a sequence alignment and must stay one; if someone ever
// replaces it with something simpler, that test is the one that will go
// red first.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}
function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
}

// Extracted by name from the shipping file, so a rename breaks this loudly
// instead of letting it go green against a stale copy.
const api = new Function('window', 'console',
  [stmt('var SLATE_MATCH_SKIP'),
   stmt('var SLATE_SEQUENCE'),
   block('function slateSequencePair'),
   block('function slateSceneMatchTokens'),
   block('function slateSceneMatchScore'),
   block('function slateAlignModelScenes')].join('\n')
  + '; return { tokens: slateSceneMatchTokens, score: slateSceneMatchScore,'
  + ' align: slateAlignModelScenes };')({}, { warn() {}, error() {}, log() {} });

const { tokens, score, align } = api;

// A scene shaped the way the model returns one. Only the two fields the
// matcher reads are filled in; everything else is the merge's business.
const S = (location, int_ext) => ({ location, set: location, int_ext: int_ext || 'INT' });

// ══════════════════════════════════════════════════
console.log('\nWhat counts as a word worth matching on');
{
  ok('INT and EXT are not matching words — every heading has one',
     tokens('INT. MAMA BOLA KITCHEN - DAY').join('|') === 'MAMA|BOLA|KITCHEN|DAY',
     tokens('INT. MAMA BOLA KITCHEN - DAY').join('|'));
  ok('nor are THE, A, OF, AT, IN, ON',
     tokens('THE BACK OF THE DANFO').join('|') === 'BACK|DANFO',
     tokens('THE BACK OF THE DANFO').join('|'));
  ok('punctuation and dashes are separators, not characters',
     tokens('EXT. OBALENDE BUS-STOP -- NIGHT').join('|') === 'OBALENDE|BUS|STOP|NIGHT',
     tokens('EXT. OBALENDE BUS-STOP -- NIGHT').join('|'));
  ok('a single letter is not a word',
     tokens('INT. ROOM B - DAY').join('|') === 'ROOM|DAY',
     tokens('INT. ROOM B - DAY').join('|'));
  // Our scripts are Yorùbá, Igbo and Hausa as often as English. A tokeniser
  // that strips diacritics would make ÌDÍ ÒRÒ and IDI ORO different places.
  ok('Yorùbá tone marks survive, intact',
     tokens('INT. ÌDÍ ÒRÒ MARKET - DAY').join('|') === 'ÌDÍ|ÒRÒ|MARKET|DAY',
     tokens('INT. ÌDÍ ÒRÒ MARKET - DAY').join('|'));
  ok('a Korean heading tokenises too',
     tokens('실내. 민준의 아파트 - 낮').length > 0,
     JSON.stringify(tokens('실내. 민준의 아파트 - 낮')));
  ok('numbers are kept — ROOM 204 is a place',
     tokens('INT. ROOM 204 - DAY').join('|') === 'ROOM|204|DAY',
     tokens('INT. ROOM 204 - DAY').join('|'));
  ok('nothing in, nothing out', tokens('').length === 0 && tokens(null).length === 0);
}

// ══════════════════════════════════════════════════
console.log('\nHow well one heading answers for one scene');
{
  ok('the same place, same side of the door, scores highest',
     score(S('MAMA BOLA KITCHEN', 'INT'), 'INT. MAMA BOLA KITCHEN - DAY') > 1,
     String(score(S('MAMA BOLA KITCHEN', 'INT'), 'INT. MAMA BOLA KITCHEN - DAY')));
  ok('the model rewording the slug line still matches',
     score(S('MAMA BOLA KITCHEN', 'INT'), '12  INT. KITCHEN, MAMA BOLA HOUSE - MORNING') >= 0.6,
     String(score(S('MAMA BOLA KITCHEN', 'INT'), '12  INT. KITCHEN, MAMA BOLA HOUSE - MORNING')));
  ok('a different place scores nothing',
     score(S('MAMA BOLA KITCHEN', 'INT'), 'EXT. OBALENDE BUS STOP - NIGHT') === 0,
     String(score(S('MAMA BOLA KITCHEN', 'INT'), 'EXT. OBALENDE BUS STOP - NIGHT')));
  // The 0.15 for INT/EXT agreeing is a tiebreak between two scenes in the
  // same place. If it were ever enough on its own, every interior in the
  // film would match every other interior.
  ok('INT agreeing is NEVER enough on its own',
     score(S('KITCHEN', 'INT'), 'INT. POLICE STATION - DAY') === 0,
     String(score(S('KITCHEN', 'INT'), 'INT. POLICE STATION - DAY')));
  ok('  ...but it does separate the interior from the exterior of one place',
     score(S('MAMA BOLA HOUSE', 'INT'), 'INT. MAMA BOLA HOUSE - DAY')
     > score(S('MAMA BOLA HOUSE', 'INT'), 'EXT. MAMA BOLA HOUSE - DAY'),
     'INT ' + score(S('MAMA BOLA HOUSE', 'INT'), 'INT. MAMA BOLA HOUSE - DAY')
     + ' vs EXT ' + score(S('MAMA BOLA HOUSE', 'INT'), 'EXT. MAMA BOLA HOUSE - DAY'));
  ok('a scene with no location at all scores nothing, rather than throwing',
     score(S(''), 'INT. KITCHEN - DAY') === 0 && score(null, 'INT. KITCHEN - DAY') === 0);
  ok('an empty heading scores nothing',
     score(S('KITCHEN'), '') === 0 && score(S('KITCHEN'), null) === 0);
  ok('the number folded onto a heading does not hurt the match',
     score(S('KITCHEN', 'INT'), '44A INT. KITCHEN - DAY') > 1,
     String(score(S('KITCHEN', 'INT'), '44A INT. KITCHEN - DAY')));
}

// ══════════════════════════════════════════════════
console.log('\nWhen the two lists agree, everything lines up');
{
  const heads = ['INT. KITCHEN - DAY', 'EXT. MARKET - DAY', 'INT. CHURCH - NIGHT'];
  const scenes = [S('KITCHEN', 'INT'), S('MARKET', 'EXT'), S('CHURCH', 'INT')];
  ok('each scene finds its own heading',
     JSON.stringify(align(scenes, heads)) === '[0,1,2]',
     JSON.stringify(align(scenes, heads)));
}

// ══════════════════════════════════════════════════
// THE ONE THAT DECIDES THE DESIGN.
console.log('\nA gap in the middle — the case the greedy version died on');
{
  // Twelve headings. The model returns the first four, then four scenes
  // whose locations appear in NO heading (it invented them, or split a
  // montage into beats, or read a CUT TO: as a scene — all of which it
  // really does), and then the last four, correctly.
  //
  // A greedy walk strands itself on the gap and loses everything after it.
  const heads = ['INT. KITCHEN - DAY', 'EXT. MARKET - DAY', 'INT. CHURCH - NIGHT',
                 'EXT. RIVER - DAWN', 'INT. CLINIC - DAY', 'EXT. ROAD - NIGHT',
                 'INT. BAR - NIGHT', 'EXT. FARM - DAY', 'INT. OFFICE - DAY',
                 'EXT. BEACH - DUSK', 'INT. BUS - DAY', 'EXT. STADIUM - NIGHT'];
  const scenes = [
    S('KITCHEN', 'INT'), S('MARKET', 'EXT'), S('CHURCH', 'INT'), S('RIVER', 'EXT'),
    S('SOMEWHERE ELSE ENTIRELY', 'INT'), S('A PLACE NOT IN THE SCRIPT', 'EXT'),
    S('NOWHERE NEAR IT', 'INT'), S('UNRELATED COMPOUND', 'EXT'),
    S('OFFICE', 'INT'), S('BEACH', 'EXT'), S('BUS', 'INT'), S('STADIUM', 'EXT')
  ];
  const got = align(scenes, heads);

  ok('the four before the gap are matched',
     JSON.stringify(got.slice(0, 4)) === '[0,1,2,3]', JSON.stringify(got));
  ok('the four in the gap are matched to NOTHING, not to something near',
     got.slice(4, 8).every(x => x === -1), JSON.stringify(got));
  ok('THE ALIGNMENT RECOVERS: all four after the gap are matched',
     JSON.stringify(got.slice(8)) === '[8,9,10,11]', JSON.stringify(got)
     + '  <- a greedy walk returns -1,-1,-1,-1 here. This is the producer bug.');
}

// ══════════════════════════════════════════════════
console.log('\nWhen the model splits a scene we read as one');
{
  const heads = ['INT. KITCHEN - DAY', 'EXT. MARKET - DAY', 'INT. CHURCH - NIGHT'];
  // The model returns the market as two scenes. Both describe the market;
  // only one of them can be the heading that carries the number.
  const scenes = [S('KITCHEN', 'INT'), S('MARKET', 'EXT'), S('MARKET', 'EXT'),
                  S('CHURCH', 'INT')];
  const got = align(scenes, heads);
  ok('the scenes on either side keep their own headings',
     got[0] === 0 && got[3] === 2, JSON.stringify(got));
  ok('ONE of the two halves takes the market heading',
     (got[1] === 1) !== (got[2] === 1), JSON.stringify(got));
  ok('  ...and the other takes NO heading, rather than the church',
     got[1] === -1 || got[2] === -1, JSON.stringify(got));
}

console.log('\nWhen the model merges two scenes we read as two');
{
  const heads = ['INT. KITCHEN - DAY', 'EXT. MARKET - DAY', 'EXT. MARKET - NIGHT',
                 'INT. CHURCH - NIGHT'];
  const scenes = [S('KITCHEN', 'INT'), S('MARKET', 'EXT'), S('CHURCH', 'INT')];
  const got = align(scenes, heads);
  ok('the kitchen and the church are still right',
     got[0] === 0 && got[2] === 3, JSON.stringify(got));
  ok('the one market scene takes one of the two market headings',
     got[1] === 1 || got[1] === 2, JSON.stringify(got));
}

// ══════════════════════════════════════════════════
// These two are the properties a filmmaker actually depends on. The
// alignment guarantees them structurally, which is exactly why they are
// worth asserting: if someone replaces it with something that scans for
// best matches, both go red and the reason is on the screen.
console.log('\nThe two properties the scene numbers depend on');
{
  // A script reuses its locations constantly. MAMA BOLA PARLOUR is scene 4
  // and scene 61. A matcher that searches the whole list for the best score
  // will happily hand scene 4's number to scene 61.
  const heads = ['INT. PARLOUR - DAY', 'EXT. MARKET - DAY', 'INT. CLINIC - DAY',
                 'INT. PARLOUR - NIGHT', 'EXT. ROAD - DAY', 'INT. PARLOUR - DAWN'];
  const scenes = [S('PARLOUR', 'INT'), S('MARKET', 'EXT'), S('CLINIC', 'INT'),
                  S('PARLOUR', 'INT'), S('ROAD', 'EXT'), S('PARLOUR', 'INT')];
  const got = align(scenes, heads);
  const placed = got.filter(x => x >= 0);

  ok('a repeated location matches the one in ITS place in the film',
     JSON.stringify(got) === '[0,1,2,3,4,5]', JSON.stringify(got));
  ok('the matches never go backwards',
     placed.every((x, k) => k === 0 || x > placed[k - 1]), JSON.stringify(got));
  ok('no heading is handed to two scenes',
     new Set(placed).size === placed.length, JSON.stringify(got));
}

// ══════════════════════════════════════════════════
console.log('\nWhen there is nothing to match');
{
  ok('no scenes at all', JSON.stringify(align([], ['INT. KITCHEN - DAY'])) === '[]');
  ok('no headings at all — every scene unplaced',
     JSON.stringify(align([S('KITCHEN'), S('MARKET')], [])) === '[-1,-1]',
     JSON.stringify(align([S('KITCHEN'), S('MARKET')], [])));
  ok('neither', JSON.stringify(align([], [])) === '[]');
  ok('null arguments do not throw',
     JSON.stringify(align(null, null)) === '[]');
  ok('NOTHING matches — every scene unplaced, nothing forced',
     align([S('ALPHA'), S('BETA')], ['INT. GAMMA - DAY', 'EXT. DELTA - DAY'])
       .every(x => x === -1),
     JSON.stringify(align([S('ALPHA'), S('BETA')],
       ['INT. GAMMA - DAY', 'EXT. DELTA - DAY'])));
  // A scene the model gave no location is unplaceable. It must come out
  // unplaced, because the alternative is printing a number that belongs to
  // a different scene.
  ok('a scene with no location is left unplaced rather than guessed at',
     align([S('KITCHEN', 'INT'), S(''), S('CHURCH', 'INT')],
           ['INT. KITCHEN - DAY', 'INT. CHURCH - NIGHT'])[1] === -1,
     JSON.stringify(align([S('KITCHEN', 'INT'), S(''), S('CHURCH', 'INT')],
       ['INT. KITCHEN - DAY', 'INT. CHURCH - NIGHT'])));
}

// ══════════════════════════════════════════════════
// Shaped after the real failure: HILLS, 104 headings, the model returning
// 107 scenes, with splits and merges scattered through the film rather
// than in one convenient place.
console.log('\nA feature-length script, with disagreements scattered through it');
{
  const PLACES = ['KITCHEN', 'MARKET', 'CHURCH', 'RIVER', 'CLINIC', 'ROAD', 'BAR',
                  'FARM', 'OFFICE', 'BEACH', 'BUS', 'STADIUM', 'PARLOUR', 'SHRINE'];
  const heads = [], scenes = [], want = [];
  for (let k = 0; k < 100; k++) {
    const place = PLACES[k % PLACES.length];
    const ie = k % 3 === 0 ? 'EXT' : 'INT';
    heads.push(ie + '. ' + place + ' ' + k + ' - DAY');
    if (k % 17 === 5) continue;                       // the model missed this one
    want.push(k);
    scenes.push(S(place + ' ' + k, ie));
    if (k % 23 === 7) { want.push(-1); scenes.push(S(place + ' ' + k, ie)); } // split in two
  }
  const got = align(scenes, heads);
  const placed = got.filter(x => x >= 0);

  ok('every scene the model really returned found its own heading',
     JSON.stringify(got) === JSON.stringify(want),
     got.length + ' entries, ' + placed.length + ' placed, wanted '
     + want.filter(x => x >= 0).length);
  ok('  ...still in order', placed.every((x, k) => k === 0 || x > placed[k - 1]));
  ok('  ...still no heading used twice', new Set(placed).size === placed.length);
  ok('the headings the model skipped are simply not claimed',
     placed.length === heads.length - Math.ceil(100 / 17),
     placed.length + ' of ' + heads.length);
}

// ══════════════════════════════════════════════════
// Cost. This runs in the browser on the filmmaker's own machine, between
// the last chunk coming back and the breakdown appearing. A feature is
// about 110 scenes; this is sized well past that.
console.log('\nWhat it costs on a long script');
{
  const big = [], bigHeads = [];
  for (let k = 0; k < 400; k++) {
    bigHeads.push('INT. LOCATION NUMBER ' + k + ' COMPOUND - DAY');
    big.push(S('LOCATION NUMBER ' + k + ' COMPOUND', 'INT'));
  }
  const started = Date.now();
  const got = align(big, bigHeads);
  const took = Date.now() - started;
  ok('400 scenes against 400 headings, all matched', got.every((x, k) => x === k));
  ok('  ...in well under a second (' + took + 'ms)', took < 1000, took + 'ms');
}

// ══════════════════════════════════════════════════
// A MONTAGE HAS NO SINGLE LOCATION.
//
// Asked for a montage as ONE scene, the model returns exactly that and
// leaves the location empty, because "VARIOUS LOCATIONS" is not a place.
// With nothing to match on it scored zero against every heading, took no
// number and carried none of its beats — one empty field knocking out the
// whole feature. Observed on THE WEAVER'S DAUGHTER on 23 November: the
// montage came back labelled "#4" with its four setups nowhere.
console.log('\nA montage with no location still finds its heading');
{
  const M = (type) => ({ location: '', set: '', int_ext: '', scene_type: type });
  const heads = ['INT. LAGOS OFFICE - DAY',
                 'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING',
                 'INT. ADUKE\u2019S WORKSHOP - NIGHT'];
  const scenes = [S('LAGOS OFFICE', 'INT'), M('MONTAGE'), S('ADUKE\u2019S WORKSHOP', 'INT')];
  const got = align(scenes, heads);

  ok('the montage lands on the montage heading',
     JSON.stringify(got) === '[0,1,2]', JSON.stringify(got)
     + '  <- unplaced here means no number and no beats on the document');
  ok('  ...and it scores enough on its own',
     score(M('MONTAGE'), 'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING') >= 0.6,
     String(score(M('MONTAGE'), 'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING')));
  ok('INTERCUT and SERIES OF SHOTS count too',
     score(M('INTERCUT'), 'INTERCUT - TWO KITCHENS') >= 0.6
     && score(M('SERIES OF SHOTS'), '12. SERIES OF SHOTS - THE HARVEST') >= 0.6);

  // BOTH halves must say so, or an ordinary scene whose location the model
  // dropped would land on a montage heading and take its number.
  ok('a scene with NO location and no type matches nothing',
     score({ location: '', scene_type: '' },
           'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING') === 0,
     'a missing location must not become a free pass onto a montage');
  ok('  ...and a montage-typed scene does not take an ORDINARY heading',
     score(M('MONTAGE'), 'INT. LAGOS OFFICE - DAY') === 0,
     'the heading is the page\u2019s word and it does not say montage');

  // And a montage that DOES carry a location still wins on its words,
  // because a real location match scores higher than this fallback.
  ok('a located montage still matches on its words',
     score({ location: 'Various Locations', scene_type: 'MONTAGE' },
           'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING')
     > score(M('MONTAGE'), 'MONTAGE - VARIOUS LOCATIONS - ONE YEAR PASSING'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
