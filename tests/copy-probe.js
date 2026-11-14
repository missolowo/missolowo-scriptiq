// What we promise filmmakers, in the words they actually read.
//
// These are not mechanisms. They are commitments, and a commitment is
// easier to break by accident than a function is — somebody rewrites an
// error message in good faith and a promise goes with it. So they get a
// test, like anything else we do not want to lose.
//
// The first one has already been broken once. An error message asked
// filmmakers to send us their screenplay so we could debug our own
// infrastructure. A screenplay is the most valuable thing a writer owns,
// we had no business holding copies of scripts we did not need, and the
// ask read as though we could not see our own system. Elizabeth caught it
// in the product, not in review.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const INDEX = fs.readFileSync(__p.join(ROOT, 'index.html'), 'utf8');

// Comments are where we EXPLAIN these promises, often by quoting the thing
// we refuse to do — "we never attach the screenplay" is a promise kept, not
// an ask. Scanning them finds our own reasoning and reports it as a breach.
// What a filmmaker reads is what counts, so strip the commentary first.
const stripComments = src => src.split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
const APP_SAID = stripComments(APP);
const INDEX_SAID = stripComments(INDEX);

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

function block(src, startNeedle) {
  const s = src.indexOf(startNeedle);
  if (s < 0) { console.error('NOT FOUND: ' + startNeedle); process.exit(1); }
  let depth = 0, end = -1;
  for (let j = src.indexOf('{', s); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(s, end);
}

// ══════════════════════════════════════════════
console.log('\nWe never ask a filmmaker for their screenplay');
{
  // Deliberately broad. Any phrasing that amounts to "give us the script"
  // should trip this, not just the exact sentence we removed.
  const asks = [
    /send us (the|your) (script|screenplay)/i,
    /send me (the|your) (script|screenplay)/i,
    /email us (the|your) (script|screenplay)/i,
    /share (the|your) (script|screenplay) with us/i,
    /attach (the|your) (script|screenplay)/i,
    /forward (the|your) (script|screenplay)/i
  ];
  asks.forEach(re => {
    ok('nothing matching ' + re.source.slice(0, 34) + '…',
       !re.test(APP_SAID) && !re.test(INDEX_SAID));
  });

  // And the promise we already make elsewhere, which the error message was
  // quietly contradicting until Elizabeth caught it: the feedback form has
  // said this all along.
  ok('the feedback form still promises we never send their script',
     /We never send your script/.test(APP_SAID));
}

// ══════════════════════════════════════════════
console.log('\nA failure gives them a way forward that costs them nothing');
{
  const src = block(APP, 'function slateSupportRef') + '\n'
            + block(APP, 'function slateFailureMessage');
  const build = w => new Function('window', src + '; return slateFailureMessage;')(w);
  const withId = build({ slateProductionId: '3f9ac2d1-77b4-4e2a-9c01-8db6e5a71f23' });
  const noId = build({});

  const timeout = withId('This section took too long. Please try a shorter script section.');
  ok('a timeout says nothing was charged', /nothing has been charged/i.test(timeout));
  ok('  ...gives somewhere to write to', /support@missolowo\.com/.test(timeout));
  ok('  ...gives a reference that finds the run in our logs',
     /reference 3F9AC2D1/.test(timeout), timeout);
  ok('  ...and says outright that we do not want their screenplay',
     /do not need to send your screenplay/i.test(timeout));

  // An error message is the worst possible place for a second error.
  const bare = noId('took too long');
  ok('no production id -> no broken sentence, no "undefined"',
     !/undefined|reference\s*$|reference\s+and/i.test(bare), bare);
  ok('  ...and it still tells them where to write', /support@missolowo\.com/.test(bare));
}

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
console.log('\nWe never claim Slate knows the cast’s availability');
{
  // The app says the opposite, above every schedule: "Slate does not know
  // your cast's availability or when a location opens." Marketing that
  // contradicts the product in writing costs more than the feature it
  // oversells — a production manager who reads both trusts neither.
  //
  // Cast availability scheduling is a real thing we may build. Until then
  // the filmmaker is the one adjusting and Slate keeps the documents in
  // step while they do.
  const overclaims = [
    /slate (knows|tracks|understands|checks)[^.]{0,40}availabilit/i,
    /schedules? (around|based on)[^.]{0,30}(cast|actor)[^.]{0,20}availabilit/i,
    /automatically[^.]{0,40}(cast|actor)[^.]{0,20}availabilit/i,
    /(cast|actor)[^.]{0,20}availabilit[^.]{0,40}automatic/i
  ];
  overclaims.forEach(re => {
    ok('nothing matching ' + re.source.slice(0, 40) + '…',
       !re.test(INDEX_SAID) && !re.test(APP_SAID));
  });

  // Matched on the half that sits inside one string literal. The banner is
  // built by concatenation, so "Slate does not know " and "your cast's
  // availability" live on separate source lines with quotes and a plus
  // between them, and a regex spanning both matches nothing.
  ok('the schedule still tells filmmakers what Slate cannot see',
     /availability or when a location opens/i.test(APP_SAID),
     'the honest banner is the reason the homepage claim has to stay modest');
  ok('  ...and still tells them what to do about it',
     /tap any scene number to move it to another day/i.test(APP_SAID));
  ok('the homepage says the filmmaker is the one adapting',
     /Adapt your schedule as production changes/.test(INDEX_SAID));
  ok('  ...and that the documents follow them',
     /cast release dates/.test(INDEX_SAID) && /call sheets/.test(INDEX_SAID));
}

console.log('\nEvery failure tells them about their money');
{
  const src = block(APP, 'function slateSupportRef') + '\n'
            + block(APP, 'function slateFailureMessage');
  const msg = new Function('window', src + '; return slateFailureMessage;')({});

  // A filmmaker's first question on any failure is whether it cost them.
  // Every branch answers it, one way or the other.
  ok('out of credits says what to do and that the script is safe',
     /add more credits/i.test(msg('No credits remaining'))
     && /still here/i.test(msg('No credits remaining')));
  ok('rate limited says nothing was charged',
     /nothing has been charged/i.test(msg('Too many requests. Please try again in an hour.')));
  ok('an unrecognised failure still says nothing was charged',
     /nothing has been charged/i.test(msg('Something we have not seen before.')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
