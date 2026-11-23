// What stops a bad call sheet leaving Slate.
//
//   node tests/callsheet-guard-probe.js
//
// WHY THIS FILE EXISTS
//
// Export is the last moment a document is still ours. After it, a PDF is
// a thing people act on: it goes into WhatsApp, gets printed at a business
// centre, gets photographed, and reaches a driver at 05:30. Nothing we do
// afterwards reaches that piece of paper.
//
// So the guards on that one function are worth more than any amount of
// on-screen warning, and until tonight one of them was missing.
//
// location_address has always been correctly REFUSED rather than guessed.
// callsheet.js says so in as many words — "NEVER guessed. Blank until a
// human supplies it" — and it sets location_address_required when the
// field is empty. Nothing acted on that flag. The sheet rendered,
// exported and printed with a blank address line, and the only sign was a
// small amber note on screen that does not travel into the PDF.
//
// A call sheet exists to tell a crew where to be. Everything else on it —
// times, cast, elements, weather, hospital — is useless to somebody who
// cannot find the location.
const fs = require('fs');
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'app.html'), 'utf8');
const CS = fs.readFileSync(__p.join(ROOT, 'netlify/functions/callsheet.js'), 'utf8');

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

// The resolver, run for real. It is the only thing that knows both places
// an address can come from.
const slateCallsheetAddress = new Function('slateProductionDetails',
  block(APP, 'function slateCallsheetAddress')
  + '; return slateCallsheetAddress;');

// ══════════════════════════════════════════════════
console.log('\nThe address is never guessed');
{
  // The decision this whole probe protects. If Slate ever invents an
  // address, a unit drives to it.
  ok('callsheet.js still refuses to guess an address',
     /NEVER guessed/.test(CS) && /location_address:\s*location_address\s*\|\|\s*''/.test(CS),
     'a guessed address is worse than a blank one, because a crew acts on it');
  ok('  ...and still says when one is missing',
     /location_address_required:\s*!location_address/.test(CS));
}

console.log('\nThe resolver knows both places an address can come from');
{
  const res = (pd) => slateCallsheetAddress(pd);

  ok('the response’s own address is used',
     res({})({ location_address: '12 Bode Thomas, Surulere' })
       === '12 Bode Thomas, Surulere');

  // The case that makes the flag alone the wrong thing to check: the
  // filmmaker supplied the address in Production Details AFTER the sheet
  // was built, so location_address_required is still set and an export
  // guarded on the flag would refuse a sheet that is fine.
  ok('an address entered in Production Details afterwards counts',
     res({ locations: ['7 Awolowo Road, Ikoyi'] })({ location_address: '' })
       === '7 Awolowo Road, Ikoyi',
     'guarding on the server flag alone would block an export the filmmaker '
     + 'had already fixed');

  ok('  ...and the one naming this day’s location is preferred',
     res({ locations: ['Ikoyi base', 'Surulere compound'] })(
       { location_address: '', location: 'Surulere' }) === 'Surulere compound',
     'a production in several places needs the right address on each day');

  ok('nothing anywhere resolves to nothing',
     res({})({ location_address: '' }) === ''
     && res({ locations: [] })({}) === ''
     && res({ locations: ['', null] })({}) === '');
}

// ══════════════════════════════════════════════════
console.log('\nExport refuses a sheet with no address');
{
  const exp = APP.slice(APP.indexOf('if (slateCallsheetOutOfDate()'),
                        APP.indexOf('window.slateActiveScript = await slatePrepareFont(slateCallsheet)'));

  ok('the export path checks the resolver, not the server flag',
     /if \(!slateCallsheetAddress\(slateCallsheet\)\)/.test(exp),
     'the flag cannot see an address added in Production Details afterwards');
  ok('  ...and returns rather than exporting',
     /slateCallsheetAddress\(slateCallsheet\)\)\s*\{[\s\S]{0,600}?return;/.test(exp),
     'a warning that does not stop the export is a warning in a PDF nobody '
     + 'reads');
  ok('it names the day that needs one',
     /Day '\s*\+\s*\(slateCallsheet\.shoot_day/.test(exp),
     'a filmmaker with twelve days needs to know which one');
  ok('it says where to add it',
     /Production Details/.test(exp),
     'an error a filmmaker cannot act on is an error they work around');
  ok('  ...and repeats the promise rather than hiding it',
     /never guesses an address/.test(exp),
     'the refusal is a feature, so it is explained as one');

  // Order matters. The out-of-date check must still come first: a sheet
  // from a superseded schedule is wrong whatever its address says, and
  // sending someone to fill in an address on a sheet they must rebuild
  // anyway wastes their time.
  ok('the out-of-date check still runs first',
     APP.indexOf('if (slateCallsheetOutOfDate()')
       < APP.indexOf('if (!slateCallsheetAddress(slateCallsheet))'),
     'no point asking for an address on a sheet that has to be rebuilt');

  // And both guards must sit before the font load and the document build,
  // or Slate does the expensive work before refusing.
  ok('both guards run before the document is built',
     APP.indexOf('if (!slateCallsheetAddress(slateCallsheet))')
       < APP.indexOf("slateDoc('Call Sheet'"));
}

console.log('\nThe screen still says so before export is ever pressed');
{
  // The refusal is the backstop, not the only notice. A filmmaker should
  // learn about the missing address while looking at the sheet, not when
  // they try to send it.
  ok('the on-screen sheet marks the missing address',
     /add the address under Production Details/.test(APP),
     'being refused at export with no earlier warning reads as a bug');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
