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

// ── THE PACKS ── (PM-approved, Sep 2026)
const PACKS = {
  starter: {
    name: 'Starter',
    credits: 5,
    launch_amount: 300000,    // ₦3,000
    regular_amount: 500000,   // ₦5,000
    label: 'Missolowo Slate — Starter · 5 Credits'
  },
  professional: {
    name: 'Professional',
    credits: 15,
    launch_amount: 850000,    // ₦8,500
    regular_amount: 1000000,  // ₦10,000
    label: 'Missolowo Slate — Professional · 15 Credits'
  },
  studio: {
    name: 'Studio',
    credits: 40,
    launch_amount: 2000000,   // ₦20,000
    regular_amount: 2500000,  // ₦25,000
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

// ── How many distinct people have paid? ──
// Distinct user_id in payments where the payment succeeded. A customer
// who buys twice is one customer, which is what the page promises.
// If the count cannot be read, we fall back to LAUNCH pricing: charging
// someone less than expected is recoverable, charging them more is not.
async function countPayingCustomers(supabase) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('user_id')
      .eq('status', 'success');
    if (error || !data) return null;
    const seen = {};
    data.forEach(function (row) { if (row.user_id) seen[row.user_id] = true; });
    return Object.keys(seen).length;
  } catch (e) {
    return null;
  }
}

// Which price applies right now, for one pack.
async function priceFor(packKey, supabase) {
  const pack = PACKS[packKey];
  if (!pack) return null;
  const paying = await countPayingCustomers(supabase);
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
async function allPrices(supabase) {
  const keys = Object.keys(PACKS);
  const out = [];
  for (let i = 0; i < keys.length; i++) out.push(await priceFor(keys[i], supabase));
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
