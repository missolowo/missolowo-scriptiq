// ============================================
// MISSOLOWO SLATE — PRICING (read-only)
// ============================================
// What the pricing page and the upgrade panel render. The page holds
// no prices of its own: it asks this endpoint and displays the answer,
// so a price change is an edit to lib/slate-pricing.js and nothing else.
//
// Also reports whether the launch offer is still running, so the page
// can stop showing it the moment the 100th customer has paid without
// anyone remembering to take the banner down.
// ============================================
const { createClient } = require('@supabase/supabase-js');
const { allPrices, LAUNCH_CUSTOMER_LIMIT, CURRENCY, SIGNUP_FREE_CREDITS } = require('./lib/slate-pricing');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    // Prices change rarely; the launch flag changes once. A short cache
    // keeps the page fast without leaving a stale offer on screen for long.
    'Cache-Control': 'public, max-age=60'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: Object.assign({}, headers, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }), body: '' };
  }

  try {
    const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
    const supabase = SUPABASE_SECRET ? createClient(SUPABASE_URL, SUPABASE_SECRET) : null;
    const packs = await allPrices(supabase);
    const onLaunch = packs.length > 0 && packs[0].on_launch_offer;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        currency: CURRENCY,
        signup_free_credits: SIGNUP_FREE_CREDITS,
        launch_offer_active: onLaunch,
        launch_customer_limit: LAUNCH_CUSTOMER_LIMIT,
        // Every credit buys the whole chain for one screenplay — the
        // page should say so rather than listing documents separately.
        includes: ['Script Breakdown', 'Shooting Schedule', 'Call Sheet'],
        packs: packs.map(function (p) {
          return {
            key: p.key, name: p.name, credits: p.credits,
            amount: p.amount,                       // kobo, what will be charged
            price: Math.round(p.amount / 100),      // naira, for display
            regular_price: Math.round(p.regular_amount / 100),
            on_launch_offer: p.on_launch_offer
          };
        })
      })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not load pricing: ' + error.message }) };
  }
};
