// Prices appear in three places. They must agree.
//
// lib/slate-pricing.js is the source of truth — it is what the checkout
// charges. index.html duplicates it twice: once in JSON-LD for search
// engines, once as visible text for crawlers that do not run JavaScript.
//
// Duplication was never the problem. Silence was. Typed prices lived in
// that page once, drifted to ₦3,000 against a ₦4,000 checkout, and nobody
// found out until a human noticed. This probe turns that into a failing
// test the next time anyone edits a number.
//
// Both copies must carry the REGULAR price, never the launch price. The
// pricing file's own rule: charging someone less than expected is
// recoverable, charging them more is not. The regular price is the
// ceiling — the most this product ever costs — so a stale copy can only
// ever quote too high, which costs us a little marketing and costs a
// filmmaker nothing. The launch price in that position would be a promise
// broken at the till the moment the hundredth customer pays.
const __p = require('path');
const fs = require('fs');
const ROOT = __p.resolve(__dirname, '..');
const APP = fs.readFileSync(__p.join(ROOT, 'index.html'), 'utf8');
const PRICING_SRC = fs.readFileSync(
  __p.join(ROOT, 'netlify', 'functions', 'lib', 'slate-pricing.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// ── The source of truth ──
// Read as text rather than required, so this works whether or not the
// Supabase client is installed.
const packs = [];
const packRe = /credits:\s*(\d+),\s*\n\s*launch_amount:\s*(\d+),[^\n]*\n\s*regular_amount:\s*(\d+)/g;
let m;
while ((m = packRe.exec(PRICING_SRC)) !== null) {
  packs.push({
    credits: Number(m[1]),
    launch: Number(m[2]) / 100,
    regular: Number(m[3]) / 100
  });
}

console.log('\nThe source of truth parses');
ok('three packs found in slate-pricing.js', packs.length === 3, String(packs.length));
ok('every pack has a regular price above its launch price',
   packs.every(p => p.regular > p.launch), JSON.stringify(packs));

// ── Visible prices in the markup ──
// Capture the group, not the whole match — "&#8358;" carries digits of its
// own, and stripping non-digits from the match turns ₦5,000 into 83,585,000.
const visible = [];
const visibleRe = /class="price__amount">&#8358;([\d,]+)</g;
let vm;
while ((vm = visibleRe.exec(APP)) !== null) visible.push(Number(vm[1].replace(/,/g, '')));

console.log('\nVisible prices, which is all most crawlers read');
ok('a price is printed on every card', visible.length === packs.length,
   JSON.stringify(visible));
packs.forEach((p, i) => {
  ok('card ' + (i + 1) + ' shows the REGULAR price ₦' + p.regular.toLocaleString(),
     visible[i] === p.regular, 'found ₦' + (visible[i] || 0).toLocaleString());
});
packs.forEach((p, i) => {
  ok('  card ' + (i + 1) + ' is never BELOW what checkout charges',
     (visible[i] || 0) >= p.launch && (visible[i] || 0) >= p.regular,
     'card ₦' + (visible[i] || 0) + ' vs launch ₦' + p.launch + ' / regular ₦' + p.regular);
});

// ── JSON-LD, which is what search engines read ──
const offers = [];
const offerRe = /"@type":\s*"Offer"[^}]*?"price":\s*"(\d+)"/g;
while ((m = offerRe.exec(APP)) !== null) offers.push(Number(m[1]));

console.log('\nJSON-LD, which is what a search engine quotes');
ok('an offer for every pack', offers.length === packs.length, JSON.stringify(offers));
packs.forEach((p, i) => {
  ok('offer ' + (i + 1) + ' advertises the regular price', offers[i] === p.regular,
     'advertised ₦' + (offers[i] || 0) + ', regular is ₦' + p.regular);
});
packs.forEach((p, i) => {
  ok('  offer ' + (i + 1) + ' never advertises below the till',
     (offers[i] || 0) >= p.launch,
     'advertised ₦' + (offers[i] || 0) + ' vs launch ₦' + p.launch);
});

console.log('\nThe three copies agree with each other');
ok('visible markup matches JSON-LD',
   JSON.stringify(visible) === JSON.stringify(offers),
   JSON.stringify(visible) + ' vs ' + JSON.stringify(offers));
ok('both match slate-pricing.js',
   JSON.stringify(visible) === JSON.stringify(packs.map(p => p.regular)),
   JSON.stringify(visible) + ' vs ' + JSON.stringify(packs.map(p => p.regular)));

console.log('\nThe live price still wins for anyone with a browser');
ok('the script replaces the grid from /pricing',
   /fetch\('\/\.netlify\/functions\/pricing'\)/.test(APP));
ok('  ...and writes the live amount into the same element',
   /price__amount'?">'\s*\+\s*naira\(p\.price\)/.test(APP) ||
   /class="price__amount">'\s*\+\s*naira\(p\.price\)/.test(APP));
ok('  ...and strikes through the regular price while the offer runs',
   /price__was[\s\S]{0,120}naira\(p\.regular_price\)/.test(APP));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
