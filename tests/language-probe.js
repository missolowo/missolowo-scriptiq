// One name per language, wherever it is written.
//
// On 17 November the database held 8 free-user productions in 'en' and 5 in
// 'English' — the same language, counted twice — plus the literal string
// 'auto', which is not a language. Three code paths wrote the field and
// each wrote it differently:
//
//   breakdown.js, first chunk   the chip the filmmaker picked      'en'
//   breakdown.js, last chunk    what the model detected            'English'
//   save.js                     the same, or `|| 'auto'`           'auto'
//
// It matters more than it sounds. This column is the only honest way to
// decide which of the eighteen languages on the pricing page get verified
// next, and two days went into Korean and Japanese scene headings without
// ever being able to read it. A count built on these values is wrong before
// it is run.
//
// These assertions exist because a fourth write site is the obvious next
// mistake, and nothing about adding one would fail.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const FN = __p.join(ROOT, 'netlify', 'functions');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

const { slateCanonLanguage: canon } = require(__p.join(FN, 'lib', 'slate-core.js'));
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const BREAKDOWN = fs.readFileSync(__p.join(FN, 'breakdown.js'), 'utf8');
const SAVE = fs.readFileSync(__p.join(FN, 'save.js'), 'utf8');

// ══════════════════════════════════════════════════
console.log('\nThe two spellings in the database become one');
{
  ok("'en' and 'English' are the same language",
     canon('en') === canon('English'), canon('en') + ' vs ' + canon('English'));
  ok('  ...and that one is the readable name', canon('en') === 'English', canon('en'));
  ok("'yo' and 'Yoruba' are the same language",
     canon('yo') === canon('Yoruba') && canon('yo') === 'Yoruba', canon('yo'));
  ok('casing never makes a second language',
     canon('ENGLISH') === 'English' && canon('english') === 'English');
}

console.log('\n"auto" is not a language');
{
  ok("'auto' becomes null", canon('auto') === null, JSON.stringify(canon('auto')));
  ok('  ...and so does empty, null and undefined',
     canon('') === null && canon(null) === null && canon(undefined) === null);
  ok('  ...and "unknown"', canon('unknown') === null);
  ok('a gap is recorded as a gap, not as a guess',
     canon('auto') === null,
     'writing a default language the filmmaker never chose is worse than a null');
}

console.log('\nEvery chip on the page maps to a name');
{
  // Read straight off the markup, so a nineteenth language added to the
  // interface and not to the map fails here rather than in the database.
  const chips = [];
  const re = /data-lang="([a-z-]+)"/g;
  let m;
  while ((m = re.exec(APP)) !== null) if (chips.indexOf(m[1]) < 0) chips.push(m[1]);
  ok('the page offers 18 languages plus auto-detect', chips.length === 19,
     chips.length + ': ' + chips.join(','));

  const unmapped = chips.filter(c => c !== 'auto' && canon(c) === null);
  ok('every one of them has a canonical name', unmapped.length === 0,
     'unmapped: ' + unmapped.join(','));

  const codeish = chips.filter(c => c !== 'auto' && canon(c) === c);
  ok('  ...and none is left as its own code', codeish.length === 0,
     'still a code: ' + codeish.join(','));

  // The languages this product was built for, named explicitly: a rename
  // here should be deliberate, not incidental.
  [['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa'], ['ko', 'Korean'],
   ['ja', 'Japanese'], ['ar', 'Arabic'], ['ru', 'Russian'], ['tr', 'Turkish']]
    .forEach(([code, name]) => ok('  ' + code + ' -> ' + name, canon(code) === name, canon(code)));
}

console.log('\nA language written in its own script still lands in one bucket');
{
  // What a model answering in the screenplay's own language may hand back.
  ok('한국어 is Korean', canon('한국어') === 'Korean', canon('한국어'));
  ok('日本語 is Japanese', canon('日本語') === 'Japanese', canon('日本語'));
  ok('Yorùbá, with the marks, is Yoruba', canon('Yorùbá') === 'Yoruba', canon('Yorùbá'));
  ok('Kiswahili is Swahili', canon('Kiswahili') === 'Swahili', canon('Kiswahili'));
  ok('isiZulu is Zulu', canon('isiZulu') === 'Zulu', canon('isiZulu'));
  ok('Français is French', canon('Français') === 'French', canon('Français'));
  ok('中文 is Chinese', canon('中文') === 'Chinese', canon('中文'));
  ok('  ...and so is Mandarin', canon('Mandarin') === 'Chinese', canon('Mandarin'));
}

console.log('\nSomething new is kept, not swallowed');
{
  // The row worth noticing. Nulling an unrecognised language would hide
  // exactly the case that should prompt a conversation.
  ok('an unknown language survives', canon('Tiv') === 'Tiv', canon('Tiv'));
  ok('  ...trimmed', canon('  Efik  ') === 'Efik', JSON.stringify(canon('  Efik  ')));
  ok('  ...and capped, so a model essay cannot become a column value',
     canon('x'.repeat(200)).length === 40, String(canon('x'.repeat(200)).length));
}

// ══════════════════════════════════════════════════
console.log('\nEvery write site goes through it');
{
  const sites = [
    ['breakdown.js, first chunk (the chip picked)', BREAKDOWN],
    ['breakdown.js, last chunk (what was detected)', BREAKDOWN],
    ['save.js', SAVE]
  ];
  ok('breakdown.js imports the normaliser',
     /slateCanonLanguage/.test(BREAKDOWN.slice(0, BREAKDOWN.indexOf('exports.handler'))),
     'imported after the handler is too late');
  ok('save.js imports it too', /require\(.\.\/lib\/slate-core.\)[\s\S]{0,200}/.test(SAVE)
     && /slateCanonLanguage/.test(SAVE));

  // No write of this column may bypass it.
  const writes = [];
  [['breakdown.js', BREAKDOWN], ['save.js', SAVE]].forEach(([name, src]) => {
    const re = /script_language:\s*([^\n]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) writes.push([name, m[1].trim()]);
  });
  ok('all script_language writes were found', writes.length >= 3,
     JSON.stringify(writes));
  const raw = writes.filter(([, expr]) => !/slateCanonLanguage/.test(expr));
  ok('every one of them calls slateCanonLanguage', raw.length === 0,
     JSON.stringify(raw));
  ok("and nothing writes the word 'auto' as a language",
     !writes.some(([, expr]) => /'auto'/.test(expr)),
     JSON.stringify(writes));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
