// The credit is claimed before it is taken.
//
// On 17 November the database showed ten filmmakers charged a total of
// twelve credits for breakdowns they never received. One had paid three
// credits for one delivered breakdown. Four were left at zero, facing a
// payment page for a product that had just failed them.
//
// The cause was an order of two writes. The code charged the credit, then
// wrote charged_at — with no transaction around them:
//
//     const charge = await slateChargeCredit(...)        // credit gone
//     await slateMarkProduction(..., { charged_at })     // record of it
//
// A run cut off between those lines took the credit and left no trace. And
// because charged_at is also the idempotency key, the next attempt found no
// record and charged again. The gateway timeout cut runs off at roughly
// 26-30 seconds while functions ran to 45, so this was not a rare race: it
// was the normal consequence of the product's main failure mode.
//
// Claiming first inverts which way an interruption falls. Worst case now is
// a breakdown nobody was charged for — the cost of the mistake lands on the
// company rather than on a filmmaker who received nothing.
//
// These assertions are about ORDER and about one conditional. Both are the
// kind of thing a later edit reverts without anything appearing to break:
// nothing fails, no test goes red, and the credits quietly start
// disappearing again.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const SRC = fs.readFileSync(__p.join(ROOT, 'netlify', 'functions', 'breakdown.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// The charging block, bounded by its own opening condition and the line
// that follows it, so these assertions cannot accidentally match code
// elsewhere in a 700-line function.
const start = SRC.indexOf('if (isLastChunk && user && !isAdmin) {');
const end = SRC.indexOf('breakdown.user_role = user.role;', start);
const BLOCK = SRC.slice(start, end > start ? end : start + 4000);

ok('the charging block was found', start > 0 && end > start,
   'start ' + start + ' end ' + end);

// ══════════════════════════════════════════════════
console.log('\nThe claim comes before the charge');
{
  const claimAt = BLOCK.indexOf(".is('charged_at', null)");
  const chargeAt = BLOCK.indexOf('slateChargeCredit');
  ok('charged_at is claimed in the block', claimAt > 0, 'claim not found');
  ok('the credit is taken in the block', chargeAt > 0, 'charge not found');
  ok('and the claim happens FIRST', claimAt > 0 && chargeAt > 0 && claimAt < chargeAt,
     'claim at ' + claimAt + ', charge at ' + chargeAt
     + ' — charging first is the bug that cost ten filmmakers twelve credits');
}

console.log('\nThe claim is atomic, so two runs cannot both win it');
{
  ok("it is a conditional update on charged_at being null",
     /\.update\(\{\s*charged_at[\s\S]{0,200}?\.is\('charged_at', null\)/.test(BLOCK),
     'without the is(null) condition, two concurrent runs both charge');
  ok('  ...scoped to this production', /\.eq\('production_id', production_id\)/.test(BLOCK));
  ok('  ...and it reads back whether it won',
     /\.select\('production_id'\)/.test(BLOCK),
     'an update that does not report what it changed cannot settle who claimed it');
  ok('winning the claim is what permits the charge',
     /claimed = !!\(won && won\.length\)/.test(BLOCK), 'the claim must decide, not a prior read');
}

console.log('\nA read-then-write guard is NOT used any more');
{
  // The old shape: select charged_at, decide in JavaScript, then charge.
  // Two concurrent runs both read null and both charge.
  const oldGuard = /\.select\('charged_at'\)[\s\S]{0,300}?if \(prod && prod\.charged_at\)/.test(BLOCK);
  ok('the old select-then-decide guard is gone', !oldGuard,
     'reading a value and acting on it later is not idempotency');
}

console.log('\nAn interruption falls in the filmmaker’s favour');
{
  ok('a failed charge does NOT release the claim',
     !/charged_at:\s*null/.test(BLOCK),
     'releasing the claim lets a retry charge for a breakdown already delivered');
  ok('  ...and the documents are still delivered',
     /delivered anyway/.test(BLOCK),
     'refusing a breakdown already generated and paid for at the API is the worse outcome');
  ok('a claim that cannot be made means no charge',
     /claimed = false;[\s\S]{0,80}alreadyCharged = true;/.test(BLOCK),
     'if the claim throws, charging anyway reintroduces the unrecorded charge');
}

console.log('\nAdmins are still never charged');
{
  ok('the whole block is gated on !isAdmin', /isLastChunk && user && !isAdmin/.test(BLOCK));
}

console.log('\nAnd it still only charges once, on the last chunk');
{
  ok('gated on isLastChunk', /isLastChunk/.test(BLOCK),
     'charging per chunk would bill a 47-scene script twelve times');
  const charges = (BLOCK.match(/slateChargeCredit/g) || []).length;
  ok('there is exactly one call to slateChargeCredit', charges === 1, charges + ' found');
  ok('an already-claimed production is not charged again',
     /already_charged = true/.test(BLOCK));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
