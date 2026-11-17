// Telling MailerLite about a signup, without letting it near the signup.
//
// Two things in this file could go badly wrong and would look fine:
//
//   1. If the endpoint took an email address from the request body, anyone
//      could post to it and subscribe any address they liked, from
//      Elizabeth's own sending domain. That is a spam relay with her name
//      on it, and the first thing it would cost her is the domain
//      reputation that signup confirmation emails depend on. The address
//      must come from the verified token and from nowhere else.
//
//   2. If a MailerLite failure could reach the signup path, an email
//      provider's bad afternoon would stop filmmakers creating accounts.
//      The product has 52 of those and cannot spare one.
//
// Plus the consent record, which exists to answer a question that is only
// ever asked when it matters: which words did this person actually read.
// A version string that silently covers two different notices is worth
// nothing, so the notice text and the version are asserted together.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const FN = __p.join(ROOT, 'netlify', 'functions');
const SUB = fs.readFileSync(__p.join(FN, 'subscribe.js'), 'utf8');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// ══════════════════════════════════════════════════
console.log('\nThe address comes from the token, never from the request');
{
  ok('the subscriber email is the authenticated user',
     /email:\s*user\.email/.test(SUB), 'anything else is a spam relay');
  ok('the request body is never parsed for an address',
     !/JSON\.parse\(event\.body\)/.test(SUB),
     'this endpoint has no business reading a body at all');
  ok('  ...and no parameter can name who gets subscribed',
     !/body\.email\s*\|\||req\.email|params\.email/.test(SUB));
  ok('it authenticates with the shared verifier',
     /slateAuthenticate\(event, supabase\)/.test(SUB),
     'parsing a JWT here instead is how this class of bug returns');
  ok('  ...and refuses an unauthenticated caller',
     /if \(!auth\.ok\)/.test(SUB));
  ok('it is rate limited', /checkRateLimit\(/.test(SUB));
}

console.log('\nThe key never leaves the server');
{
  ok('the API key is read from the environment',
     /process\.env\.MAILERLITE_API_KEY/.test(SUB));
  ok('the group id too, so it can change without a deploy',
     /process\.env\.MAILERLITE_SIGNUP_GROUP_ID/.test(SUB));
  ok('NO MailerLite key appears in app.html',
     !/MAILERLITE_API_KEY|mailerlite.*(?:key|token)\s*[:=]\s*['"]/i.test(APP),
     'this repository is public');
  ok('  ...and app.html never calls MailerLite directly',
     !/connect\.mailerlite\.com/.test(APP),
     'a browser calling MailerLite means the key is in the browser');
  ok('a missing key is a normal state, not an error',
     /if \(!MAILERLITE_API_KEY \|\| !MAILERLITE_GROUP_ID\)/.test(SUB),
     'until Elizabeth sets it in Netlify, this must look like success');
}

// ══════════════════════════════════════════════════
console.log('\nA MailerLite failure cannot touch a signup');
{
  ok('the client does NOT await the call',
     /slateTellMailerLite\(token\);/.test(APP)
     && !/await slateTellMailerLite/.test(APP),
     'awaiting it puts an email provider in the signup path');
  const fn = APP.slice(APP.indexOf('function slateTellMailerLite'),
                       APP.indexOf('window.handleSignupInline'));
  ok('  ...and swallows a rejected fetch', /\.catch\(function \(\)/.test(fn), fn.slice(0, 200));
  ok('  ...and a thrown one', /catch \(e\) \{/.test(fn));
  ok('it runs AFTER the account exists',
     APP.indexOf("siqTrack('signup_completed'") < APP.indexOf('slateTellMailerLite(token)'),
     'the account is created before this is ever called');
  ok('the function answers 200 even when MailerLite fails',
     (SUB.match(/statusCode: 200/g) || []).length >= 3,
     'a non-200 surfaces in the browser to somebody who has just joined');
  ok('the MailerLite call is aborted on a timeout',
     /AbortController/.test(SUB) && /controller\.abort\(\)/.test(SUB),
     'a hanging provider must not become a hanging function');
  ok('  ...and the timer is always cleared',
     /finally \{\s*clearTimeout/.test(SUB));
  ok('an unexpected throw still answers 200',
     /catch \(e\) \{[\s\S]{0,200}statusCode: 200/.test(SUB));
  ok('a MailerLite error body is never logged',
     !/await res\.text\(\)|await res\.json\(\)/.test(SUB),
     'an error body can echo the address back, and a log is not the place for it');
}

// ══════════════════════════════════════════════════
console.log('\nA blank name sends no name field at all');
{
  ok('the name is only set when there is one',
     /if \(fullName\) body\.fields\.name = fullName;/.test(SUB),
     'an empty string still substitutes, and the filmmaker reads "Hi ,"');
  ok('  ...and it is the name exactly as stored',
     /body\.fields\.name = fullName/.test(SUB) && !/split_part|\.split\(' '\)\[0\]/.test(SUB),
     'the first word is wrong for roughly one in five of these filmmakers');
}

console.log('\nThe consent record says which words they read');
{
  ok('a notice version is sent with every subscriber',
     /signup_notice_version: SLATE_SIGNUP_NOTICE_VERSION/.test(SUB));
  const version = (SUB.match(/SLATE_SIGNUP_NOTICE_VERSION = '([^']+)'/) || [])[1];
  ok('  ...and it is set', !!version, String(version));

  // The notice itself, in the page, and the version in the function. These
  // two must move together: a version covering two different notices
  // answers the only question a consent record exists to answer, wrongly.
  const NOTICE = "By signing up, you'll get a welcome email and occasional updates from Missolowo Slate. You can unsubscribe at any time.";
  ok('the exact notice is on the signup form', APP.indexOf(NOTICE) > 0,
     'the version above refers to this sentence');
  ok('  ...and the function quotes it, so a change here is visible there',
     SUB.indexOf('occasional updates') > 0,
     'bump the version when the wording changes');

  ok('the signup time is the ACCOUNT time, not the clock',
     /slateMailerLiteTime\(createdAt\)/.test(SUB),
     'replayed later, the clock would record the wrong moment of consent');
  ok('  ...formatted as MailerLite requires, not ISO-8601',
     /replace\('T', ' '\)/.test(SUB),
     "the 'T' in toISOString() alone makes the value invalid");
  ok('the signup IP is recorded', /body\.ip_address = ip/.test(SUB));
  ok('  ...and used for nothing else',
     (SUB.match(/\bip\b/g) || []).length <= 4,
     'it is a consent record, not analytics');
}

console.log('\nIt is only a signup hook, and only once');
{
  const calls = (APP.match(/slateTellMailerLite\(/g) || []).length;
  ok('called from exactly one place, plus its definition', calls === 2,
     calls + ' occurrences');
  ok('not called on login',
     APP.indexOf('slateTellMailerLite') < APP.indexOf('window.handleLoginInline'),
     'a returning filmmaker has not just consented to anything');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
