// What we know about the 233 people who did not get a breakdown.
//
// On 16 November the product had 234 visitors and one completed breakdown,
// and no way to say where the rest went. It fired 21 analytics events, and
// 20 of them fired AFTER breakdown_started — retries, language drift, PDF
// exports, payments. Between a visitor landing and a breakdown beginning
// there was exactly one event: home_cta_click. Signup, login, choosing a
// file and pressing Generate all reported nothing.
//
// Not a decision. An accident of scope: siqTrack was defined twice, once
// privately inside each of two script blocks, and the auth code sat in a
// third block that could reach neither. There is one definition now, on
// window, in the head block every other block can see.
//
// These assertions exist because an analytics call is the easiest thing in
// a codebase to delete by accident. Nothing breaks, no test fails, no
// filmmaker complains — the funnel just goes quiet again and nobody knows
// for a month.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const INDEX = fs.readFileSync(__p.join(ROOT, 'index.html'), 'utf8');

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

// ══════════════════════════════════════════════════
console.log('\nOne tracker, reachable from every block');
{
  const defs = (APP.match(/function siqTrack\s*\(/g) || []).length;
  ok('siqTrack is defined exactly once', defs === 0, defs + ' local definition(s) remain');
  ok('  ...and that one is on window',
     /window\.siqTrack = function/.test(APP),
     'a tracker private to one IIFE is why auth reported nothing');
  ok('  ...defined in the head block, before the body scripts',
     APP.indexOf('window.siqTrack = function') < APP.indexOf('<body'),
     'defined later, the handlers that call it would still resolve, but only by luck');
}

console.log('\nDeploy previews stay out of the production property');
{
  const t = block('window.siqTrack = function');
  ok('siqTrack checks siqIsPreview', /if \(siqIsPreview\) return;/.test(t), t.slice(0, 200));
  ok('  ...and gtag is only configured when not a preview',
     /if \(!siqIsPreview\) \{[\s\S]{0,120}gtag\('config'/.test(APP));
  ok('  ...and it never throws into the product',
     /catch \(e\)/.test(t), 'analytics must not be able to break a breakdown');
}

// ══════════════════════════════════════════════════
console.log('\nEvery step between landing and breakdown reports something');
const STEPS = [
  ['auth_opened',      'the sign-in box was opened'],
  ['signup_submitted', 'the signup form was actually sent'],
  ['signup_failed',    'a signup was refused'],
  ['signup_completed', 'an account now exists'],
  ['login_failed',     'a sign-in was refused'],
  ['login_completed',  'someone got in'],
  ['script_provided',  'a screenplay is in the box'],
  ['script_rejected',  'a file was chosen and could not be read'],
  ['breakdown_blocked','Generate was pressed and nothing happened'],
  ['breakdown_started','the run began']
];
STEPS.forEach(([name, why]) => {
  ok(name.padEnd(19) + why, APP.indexOf("siqTrack('" + name + "'") >= 0,
     'this step is dark again');
});

console.log('\nThe three ways Generate can do nothing are each counted');
{
  const gen = APP.slice(APP.indexOf("generateBtn.addEventListener('click'"));
  const seg = gen.slice(0, 1800);
  ['no_script', 'not_signed_in', 'no_credits'].forEach(r => {
    ok('blocked: ' + r, seg.indexOf("reason: '" + r + "'") >= 0,
       'a click that goes nowhere is the most expensive thing on this page');
  });
}

// ══════════════════════════════════════════════════
console.log('\nNothing personal is ever sent');
{
  // The rule ops-metrics keeps: counts, durations and fixed category words.
  // An analytics property is not a place anyone audits, so the check has to
  // be here. Scanning the ARGUMENTS of every siqTrack call, not the file.
  const calls = [];
  let i = 0;
  while ((i = APP.indexOf('siqTrack(', i)) >= 0) {
    let depth = 0, j = APP.indexOf('(', i), end = j;
    for (; j < APP.length; j++) {
      if (APP[j] === '(') depth++;
      else if (APP[j] === ')') { depth--; if (!depth) { end = j; break; } }
    }
    calls.push(APP.slice(i, end + 1));
    i = end + 1;
  }
  ok('every siqTrack call was readable', calls.length >= 25, calls.length + ' found');

  const BANNED = [
    [/\bemail\b/i,            'an email address'],
    [/\bpassword\b/i,         'a password'],
    [/\bfull_name\b|\bname:/i,'a name'],
    [/scriptText|extractedScriptText|\btext\b\s*[,)]/, 'script text'],
    [/slateUploadedName|file\.name|fileName/, 'a filename, which is usually the title'],
    [/\btitle\b/i,            'a script title'],
    [/\breference\b|payment_ref/i, 'a payment reference']
  ];
  const leaks = [];
  calls.forEach(c => {
    BANNED.forEach(([re, what]) => {
      if (re.test(c)) leaks.push(what + '  in  ' + c.replace(/\s+/g, ' ').slice(0, 90));
    });
  });
  ok('no call carries anything personal', leaks.length === 0, leaks.join('   ||   '));
}

console.log('\nAn auth failure is reduced to a category, never passed through');
{
  const fn = block('function slateAuthFailReason');
  const reason = new Function(fn + '; return slateAuthFailReason;')();
  ok('the password rule is its own bucket',
     reason('Password should be at least 8 characters') === 'password_rule',
     reason('Password should be at least 8 characters'));
  ok('  ...and so is an address already in use',
     reason('User already registered') === 'email_taken');
  ok('  ...and a wrong password at sign-in is NOT the password rule',
     reason('Invalid login credentials') === 'wrong_credentials',
     'these two mean opposite things: one is a new user we lost, one is a returning user');
  ok('an unknown message becomes "other"',
     reason('Teapot unavailable: ada@example.com') === 'other',
     'never a passthrough — an error field is exactly where a typed address ends up');
  ok('  ...and the message itself is not returned in any branch',
     !/return (?:m|msg|String)/.test(fn), fn.slice(0, 120));

  // The call sites must pass the bucket, not the raw message.
  const sign = APP.slice(APP.indexOf('window.handleSignupInline'),
                         APP.indexOf('window.handleLoginInline'));
  ok('signup reports the bucket', /slateAuthFailReason\(slateWhy\)/.test(sign));
  ok('  ...and falls back to password_rule when the server said nothing',
     /: 'password_rule'/.test(sign),
     'because the default message the user then reads IS the password rule');
}

// ══════════════════════════════════════════════════
console.log('\nThe homepage still reports its one event');
{
  ok('home_cta_click survives', /siqTrack\('home_cta_click'/.test(INDEX));
  ok('  ...and index.html guards previews too', /siqIsPreview/.test(INDEX));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
