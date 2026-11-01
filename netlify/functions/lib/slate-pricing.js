// ============================================================
// MISSOLOWO SLATE — PRICING (single source of truth)
// ============================================================
// EVERY price, credit quantity and promotion rule lives in this
// file and nowhere else. Changing a price is editing a number
// here and committing — no other file needs touching, and the
// website only ever displays what this file says.
//
// Prices are NEVER accepted from the browser. The amount sent to
// Paystack is looked up here by pack name, and checked again here
// when the payment is verified.
//
// Amounts are in KOBO: naira × 100. ₦3,000 is 300000.
// ============================================================
const { internalUserIds } = require('./slate-core');

// ── THE PACKS ── (PM-approved, Oct 2026)
//
// Two rules govern this table, and pricing-probe.js enforces both:
//
//   1. The price per credit FALLS as the pack grows. Without that, a
//      heavier user is better off buying the small pack repeatedly, and
//      the packs we most want sold are the ones nobody rational buys.
//      An earlier draft had Starter at ₦600/credit against Pro at ₦850,
//      which made two Starters ₦2,500 cheaper than one Pro for the same
//      ten credits.
//
//   2. No combination of smaller packs may beat a larger one. Rule 1 is
//      necessary but not sufficient once pack sizes stop dividing evenly,
//      so the probe checks every combination rather than just the slope.
//
// The launch discount is uniform at 20%, so every pack moves by the same
// quarter when the offer ends. An uneven discount put a 67% jump on
// Starter against 18% on Pro — customer 100 and customer 101 paying very
// different prices for the same thing, on a market where those two people
// meet on set within a month.
const PACKS = {
  starter: {
    name: 'Starter',
    credits: 5,
    launch_amount: 400000,    // ₦4,000  — ₦800/credit
    regular_amount: 500000,   // ₦5,000  — ₦1,000/credit
    label: 'Missolowo Slate — Starter · 5 Credits'
  },
  professional: {
    name: 'Professional',
    credits: 15,
    launch_amount: 1000000,   // ₦10,000 — ₦667/credit
    regular_amount: 1250000,  // ₦12,500 — ₦833/credit
    label: 'Missolowo Slate — Professional · 15 Credits'
  },
  studio: {
    name: 'Studio',
    credits: 40,
    launch_amount: 2500000,   // ₦25,000 — ₦625/credit
    regular_amount: 3100000,  // ₦31,000 — ₦775/credit
    label: 'Missolowo Slate — Studio · 40 Credits'
  }
};

// ── THE LAUNCH OFFER ──
// One global switch, not a counter per pack. While fewer than
// LAUNCH_CUSTOMER_LIMIT distinct people have completed a purchase,
// every pack sells at its launch price. Once the limit is reached,
// every pack reverts to its regular price.
//
// No time limit by design (PM ruling): the count alone decides, so
// nothing depends on a launch date being set correctly.
const LAUNCH_CUSTOMER_LIMIT = 100;

// Currency. USD is not enabled on the Paystack account, so naira is
// the only currency we can charge in. When USD is approved, add it
// here and to the packs above — no other file changes.
const CURRENCY = 'NGN';

const SIGNUP_FREE_CREDITS = 3;

// ── How many distinct CUSTOMERS have paid? ──
// Distinct user_id in payments where the payment succeeded. A customer
// who buys twice is one customer, which is what the page promises.
//
// Our own accounts are excluded, and that is not bookkeeping tidiness.
// Testing the live payment flow means paying real money through it —
// there is no other way to know it works. Counted, each of those tests
// would eat one of the hundred launch slots, so the launch offer would
// close early and a real customer would be charged the regular price
// after being promised the launch one. The exclusion is in this function
// rather than at the call sites because this is the figure the offer
// runs on; a caller that forgot would be wrong silently.
//
// If the count cannot be read at all, we return null and the caller falls
// back to LAUNCH pricing: charging someone less than expected is
// recoverable, charging them more is not.
//
// If the PAYMENTS read works but the internal list does not, we return the
// unfiltered count rather than null. The error is then bounded by the
// number of our own accounts — two — whereas null would put every pack
// back on launch pricing for the duration of the fault, at any customer
// number. A small known error beats a 20% discount on everything.
async function countPayingCustomers(supabase) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('user_id')
      .eq('status', 'success');
    if (error || !data) return null;
    // null means "could not tell", not "none" — see internalUserIds.
    const internal = await internalUserIds(supabase);
    const ours = {};
    (internal || []).forEach(function (id) { ours[id] = true; });
    const seen = {};
    data.forEach(function (row) {
      if (row.user_id && !ours[row.user_id]) seen[row.user_id] = true;
    });
    return Object.keys(seen).length;
  } catch (e) {
    return null;
  }
}

// Which price applies right now, for one pack.
//
// `counted` lets a caller that already has the number pass it in. Without
// it, rendering the pricing page ran this count once per pack — three
// identical pairs of queries for one page, on the one page that must not
// be slow.
async function priceFor(packKey, supabase, counted) {
  const pack = PACKS[packKey];
  if (!pack) return null;
  const paying = (counted === undefined) ? await countPayingCustomers(supabase) : counted;
  // null means we could not count — use the launch price, see above.
  const onLaunch = (paying === null) || (paying < LAUNCH_CUSTOMER_LIMIT);
  return {
    key: packKey,
    name: pack.name,
    label: pack.label,
    credits: pack.credits,
    amount: onLaunch ? pack.launch_amount : pack.regular_amount,
    regular_amount: pack.regular_amount,
    launch_amount: pack.launch_amount,
    on_launch_offer: onLaunch,
    currency: CURRENCY,
    paying_customers: paying
  };
}

// Every pack at today's prices — what the pricing page renders.
// Counted once, for all packs: the launch offer is one global switch, so
// every pack must be told the same number. Counting per pack also meant
// three round-trips where one does, and left open the absurd case of a
// payment landing mid-render and two packs on screen disagreeing about
// whether the offer was still running.
async function allPrices(supabase) {
  const keys = Object.keys(PACKS);
  const counted = await countPayingCustomers(supabase);
  const out = [];
  for (let i = 0; i < keys.length; i++) out.push(await priceFor(keys[i], supabase, counted));
  return out;
}

// Is this amount acceptable for this pack? Used at verification.
// Accepts either price: a customer who was quoted the launch price
// and paid it must not be refused because the 100th customer slipped
// in while their payment page was open.
function amountIsValidFor(packKey, amount) {
  const pack = PACKS[packKey];
  if (!pack) return false;
  return amount === pack.launch_amount || amount === pack.regular_amount;
}

module.exports = {
  PACKS, LAUNCH_CUSTOMER_LIMIT, CURRENCY, SIGNUP_FREE_CREDITS,
  countPayingCustomers, priceFor, allPrices, amountIsValidFor
};
