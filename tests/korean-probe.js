// Scripts whose scene headings carry no INT/EXT word at all.
//
// A Korean television script writes:
//
//   S#12. 거실 - 밤
//
// That is the whole heading. Scene number, location, time of day. There is
// no INT/EXT equivalent, and no Korean word that stands in for one — the
// convention descends from Japanese broadcast practice, not from Hollywood.
// Adding 실내 and 실외 to SLATE_HEAD would have matched almost nothing real.
//
// Two places read scene headings, and until 16 November they disagreed:
//
//   slateHeadingSrc  an INT/EXT word, OR a scene word plus a number
//   headingRe        an INT/EXT word, full stop
//
// So the splitter cut a Japanese script into three sections and ran the
// breakdown, while the health panel told the filmmaker we could not read
// their screenplay. That is the Turkish bug described in the comment on
// slateHeadingSrc, live again, for a language the pricing page lists.
//
// The invariant these assertions defend is the PAIR: the panel and the
// splitter must agree about how many scenes a script has. Either may be
// improved; neither may be improved alone.
//
// Verified: S# is the form used in Korean TV drama. 씬 and 장면 are
// plausible written-out forms and are accepted, but no real script using
// them has been seen yet. Said so here rather than in a comment that
// implies otherwise.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

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
function stmt(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  return APP.slice(s, APP.indexOf(';', s) + 1);
}

// Extracted by name, so a rename breaks this loudly rather than letting it
// test a stale copy.
const HEAD = [
  stmt('var SLATE_HEAD ='),
  stmt('var SLATE_NUM  ='),
  stmt('var SLATE_CONTD_RE'),
  stmt('var SLATE_SCENE_MARKER'),
  stmt('var SLATE_NUM_ONLY_SRC'),
  stmt('var slateHeadingSrc'),
  // The shared answer to "is this line nothing but a scene number?", and
  // the blank-line walk it wants. Both the panel and the counter now ask
  // through these instead of keeping their own copy of the pattern, which
  // is the whole point of them — so both halves of this file test the same
  // one, and a change to it cannot reach one half and not the other.
  block('function slateCleanSceneNumber'),
  block('function slateLoneSceneNumber'),
  block('function slateNextNonBlank')
].join('\n');

const check = new Function('console',
  HEAD + '\n' + block('function slateNearMatch') + '\n' + block('function slateHealthCheck') +
  '; return slateHealthCheck;')({ warn() {}, error() {}, log() {} });

const count = new Function('console',
  HEAD + '\n' + block('function slateCountScenes') +
  '; return slateCountScenes;')({ warn() {}, error() {}, log() {} });

// ══════════════════════════════════════════════════
// Fixtures. Short, but shaped the way the real thing is.
const KOREAN = `S#1. 카페 내부 – 낮

지영이 창가에 앉아 대본을 읽는다.

지영
밤이 내려온다.

S#2. 거리 – 밤

비가 내린다.

S#3. 지영의 방 – 새벽

지영이 글을 쓴다.`;

const JAPANESE = `SCENE 1 居間 (昼)

ゆきが座っている。

SCENE 2 通り (夜)

雨が降る。

SCENE 3 部屋 (朝)

ゆきが書く。`;

const ENGLISH = `INT. CAFE - DAY

She reads.

EXT. STREET - NIGHT

Rain falls.`;

const ENGLISH_NUMBERED = `1. INT. CAFE - DAY

She reads.

2. EXT. STREET - NIGHT

Rain falls.`;

const RUSSIAN = `ИНТ. КВАРТИРА - ДЕНЬ

Она читает.

НАТ. УЛИЦА - НОЧЬ

Идёт дождь.`;

const TURKISH = `İÇ. EV - GÜN

O okuyor.

DIŞ. SOKAK - GECE

Yağmur yağıyor.`;

const YORUBA = `1. INT. ILE ADA - OSAN

Ada joko.

2. EXT. OJA - ALE

Ojo n ro.`;

// The shape the whole suite was missing, and the reason branch B nearly
// shipped broken. LORI NKAN MI, IRIRI and most Nollywood scripts put the
// scene number on a line of its OWN, with the heading beneath it — and
// without the period after EXT that a Western script would have.
//
// As one regex with an alternation, branch B matched "Scene 1" and branch A
// matched "EXT DAY COMPOUND", so each scene was counted twice. Three scenes
// read as six. The suite passed anyway, because every other fixture in it
// carries its number ON the heading line.
const NOLLYWOOD = `Scene 1
EXT DAY COMPOUND
A ri Adahunse ti o duro.

Scene 2
EXT DAY MARKET
Ojo n ro.

Scene 3
INT NIGHT ILE ADA
Ada joko.`;

// And the variant with no heading line at all — the writer numbers the
// scene and goes straight into the action.
const NOLLYWOOD_BARE = `Scene 1
A ri Adahunse ti o duro ni compound.

Scene 2
Ojo n ro ni oja.

Scene 3
Ada joko ninu ile.`;

// ══════════════════════════════════════════════════
console.log('\nA Korean script is a script');
{
  const r = check(KOREAN);
  ok('the panel finds three scenes', r.sceneCount === 3, 'sceneCount ' + r.sceneCount);
  ok('  ...so it does NOT say we cannot read the screenplay',
     r.band !== 'red' && !(r.findings || []).some(f => /No scene headings/.test(f.title)),
     r.band + ' / ' + JSON.stringify((r.findings || []).map(f => f.title)));
}

console.log('\nA Japanese script is a script');
{
  // This one was failing in production on 16 November: the splitter read
  // three scenes and the panel read none.
  const r = check(JAPANESE);
  ok('the panel finds three scenes', r.sceneCount === 3, 'sceneCount ' + r.sceneCount);
  ok('  ...and does not reject it', r.band !== 'red', r.band);
}

// ══════════════════════════════════════════════════
console.log('\nA number on its own line, with the heading beneath it, is ONE scene');
{
  const r = check(NOLLYWOOD);
  ok('three scenes, not six', r.sceneCount === 3, 'sceneCount ' + r.sceneCount);
  ok('  ...and it stays green', r.band === 'green', r.band + ' / score ' + r.score);
  const b = check(NOLLYWOOD_BARE);
  ok('and with no heading line at all, still three',
     b.sceneCount === 3, 'sceneCount ' + b.sceneCount);
}

console.log('\nThe panel and the splitter agree — this is the real invariant');
[['Korean', KOREAN], ['Japanese', JAPANESE], ['English', ENGLISH],
 ['English numbered', ENGLISH_NUMBERED], ['Russian', RUSSIAN],
 ['Turkish', TURKISH], ['Yoruba', YORUBA],
 ['Nollywood', NOLLYWOOD], ['Nollywood bare', NOLLYWOOD_BARE]].forEach(([name, text]) => {
  const panel = check(text).sceneCount;
  const splitter = count(text).total;
  ok(name + ': panel ' + panel + ' = splitter ' + splitter, panel === splitter,
     'one half improved without the other is how the Turkish bug came back');
});

// ══════════════════════════════════════════════════
console.log('\nThe script’s own numbers are kept, so an AD can find the scene');
{
  // If these come back empty, labelFor prints #1 #2 #3 while the script in
  // the AD’s hands plainly says S#1 S#2 S#3. Same harm as the # bug.
  const c = count(KOREAN);
  ok('all three are counted as numbered', c.numbered === 3 && c.unnumbered === 0,
     'numbered ' + c.numbered + ', unnumbered ' + c.unnumbered);
  ok('  ...and the numbers are the script’s',
     JSON.stringify(c.numbers) === JSON.stringify(['1', '2', '3']),
     JSON.stringify(c.numbers));
  const j = count(JAPANESE);
  ok('Japanese too', JSON.stringify(j.numbers) === JSON.stringify(['1', '2', '3']),
     JSON.stringify(j.numbers));
}

console.log('\nAn unnumbered English script is still correctly unnumbered');
{
  // The other direction of the same mistake: inventing numbers for a script
  // that has none would put a number on the report that is nowhere on the
  // script. The numbering note exists to explain exactly this case.
  const c = count(ENGLISH);
  ok('two scenes, neither numbered', c.numbered === 0 && c.unnumbered === 2,
     JSON.stringify(c));
  const n = count(ENGLISH_NUMBERED);
  ok('and a numbered one is read as numbered',
     n.numbered === 2 && JSON.stringify(n.numbers) === JSON.stringify(['1', '2']),
     JSON.stringify(n));
}

// ══════════════════════════════════════════════════
console.log('\nAnd the copy that actually reaches the report');
{
  // slateCountScenes decides how the script is split and what the panel
  // says. slateSceneMarksIn is the one whose numbers go into
  // window.slateChunkNumbers, which is what labelFor prints on every
  // document. It is a separate function with its own copy of the regex, and
  // it was still reading wn[1] alone after slateCountScenes was fixed —
  // which would have shipped a green panel and a report full of #1 #2 #3.
  const marks = new Function('console',
    HEAD + '\n' + block('function slateCleanSceneNumber') +
    '\n' + block('function slateSceneTypeFrom') +
    '\n' + block('function slateRowsIn') +
    '\n' + block('function slateEighthsFromRows') +
    '\n' + stmt('var SLATE_ROWS_PER_PAGE') +
    '\n' + stmt('var SLATE_CHARS_PER_ROW') +
    '\n' + block('function slateSceneMarksIn') +
    '; return slateSceneMarksIn;')({ warn() {}, error() {}, log() {} });

  const ko = marks(KOREAN).map(m => m.number);
  ok('Korean scene numbers reach the report',
     JSON.stringify(ko) === JSON.stringify(['1', '2', '3']),
     JSON.stringify(ko) + ' — empty here means every scene prints as #n');
  const ja = marks(JAPANESE).map(m => m.number);
  ok('  ...and Japanese', JSON.stringify(ja) === JSON.stringify(['1', '2', '3']),
     JSON.stringify(ja));
  ok('an unnumbered English script still yields no numbers',
     marks(ENGLISH).every(m => !m.number),
     JSON.stringify(marks(ENGLISH).map(m => m.number)));
  ok('and a numbered one still does',
     JSON.stringify(marks(ENGLISH_NUMBERED).map(m => m.number)) ===
       JSON.stringify(['1', '2']),
     JSON.stringify(marks(ENGLISH_NUMBERED).map(m => m.number)));
  ok('the two halves of the splitter agree on the count too',
     marks(KOREAN).length === count(KOREAN).total,
     marks(KOREAN).length + ' vs ' + count(KOREAN).total);
}

// ══════════════════════════════════════════════════
console.log('\nNothing that is not a heading became one');
{
  // The negative lookahead on SLATE_HEAD. A Russian or Turkish word that
  // merely BEGINS with a heading word is prose, not a scene.
  const prose = `ИНТЕРЕСНО, подумала она.

İÇİNDE bir şey var.

INTERNATIONAL CALLS are expensive.

The scene was quiet.`;
  const r = check(prose);
  ok('prose beginning with heading words is not a scene list',
     r.sceneCount === 0, 'sceneCount ' + r.sceneCount);
  ok('  ...and the splitter agrees', count(prose).total === 0,
     JSON.stringify(count(prose)));
}

// ══════════════════════════════════════════════════
console.log('\nThe vocabulary is where both halves can see it');
{
  ok('S# is in SLATE_NUM', /S#/.test(stmt('var SLATE_NUM  =')), stmt('var SLATE_NUM  ='));
  ok('  ...and the written-out Korean forms', /씬/.test(stmt('var SLATE_NUM  =')));
  const HC = block('function slateHealthCheck');
  ok('the two branches are separate regexes, not one alternation',
     /var headingReA = new RegExp/.test(HC) && /var headingReB = new RegExp/.test(HC),
     'as one regex, both matched the same Nollywood scene and counted it twice');
  ok('  ...and B is tried only when A found nothing',
     HC.indexOf('slateReadHeadings(headingReA') < HC.indexOf('slateReadHeadings(headingReB'),
     'a script with any INT/EXT heading must read exactly as it did before');
  ok('  ...and B is anchored to the line start',
     /var headingReB = new RegExp\(\s*'\^\[ \\\\t\]\*/.test(HC),
     'unanchored, "back in scene 12 he says" becomes a scene heading');
  ok('and so does withNum, inside slateCountScenes',
     (block('function slateCountScenes').match(/SLATE_NUM/g) || []).length >= 3,
     'numOnly, branch A and branch B each reference it');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
