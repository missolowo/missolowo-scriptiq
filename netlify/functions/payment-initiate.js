// ============================================
// MISSOLOWO SLATE — PAYMENT INITIATE
// ============================================
// The amount charged is NEVER taken from the browser. It is looked
// up in lib/slate-pricing.js by pack name, so a request asking to
// pay ₦1 for the Studio pack is charged the real Studio price.
//
// Which price applies — launch or regular — is decided here too,
// by counting distinct paying customers. The page displays what
// this function says, not the other way round.
// ============================================

const fetch = (() => {
  try { return require('node-fetch'); }
  catch (e) { return global.fetch; }
})();
const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');
const { priceFor, PACKS } = require('./lib/slate-pricing');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

exports.handler = async function(event) {

  // ── CORS preflight ──
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  try {
    // "pack" is the new name; "plan" still accepted so an older page
    // does not break mid-deploy.
    const body = JSON.parse(event.body);
    const email = body.email;
    const pack = body.pack || body.plan;
    const user_id = body.user_id;

    // ── Validate inputs ──
    if (!email || !pack || !user_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'email, pack and user_id are required' })
      };
    }

    // ── Rate limit — 10 payment initiations per IP per hour ──
    const clientIP = getClientIP(event);
    const rateLimit = await checkRateLimit(clientIP, 'payment-initiate', 10, process.env.SUPABASE_SECRET_KEY, user_id || null);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'payment-initiate');

    if (!PACKS[pack]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Unknown pack "${pack}". Must be one of: ${Object.keys(PACKS).join(', ')}` })
      };
    }

    const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
    if (!SUPABASE_SECRET) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // The server decides the price. Launch or regular, counted here.
    const selectedPack = await priceFor(pack, supabase);

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Payment system not configured' })
      };
    }

    // ── Build a unique, traceable reference ──
    const reference = `slate_${pack}_${user_id}_${Date.now()}`;

    // ── Where Paystack sends the filmmaker afterwards ──
    // This MUST return them to the site they bought from. A hardcoded
    // production URL sent anyone testing on a deploy preview to
    // missolowo.com instead — a different site, where the verification
    // code never ran, so the payment completed and no credits appeared.
    //
    // The origin is taken from the request itself, so a purchase begun on
    // a preview returns to that preview and one begun on missolowo.com
    // returns there. Only our own domains are accepted: a Host header can
    // be forged, and an open redirect on a payment callback would let
    // someone send a paying customer to a page they control.
    const rawHost = String(
      (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || ''
    ).split(',')[0].trim().toLowerCase();
    const hostAllowed = /^missolowo\.com$/.test(rawHost)
      || /^www\.missolowo\.com$/.test(rawHost)
      || /^[a-z0-9-]+--missolowo-scriptiq\.netlify\.app$/.test(rawHost)
      || /^missolowo-scriptiq\.netlify\.app$/.test(rawHost);
    const origin = hostAllowed ? 'https://' + rawHost : 'https://missolowo.com';
    // Back into the Workspace, where the code that verifies the payment
    // and shows the new balance lives.
    //
    // No "#billing" on the end: Paystack appends ?reference=... to this
    // URL, and anything after a # would swallow those parameters into the
    // fragment where the browser cannot read them. The Workspace sees the
    // reference and opens the billing panel itself.
    const callbackUrl = origin + '/app.html';

    // ── Call Paystack using node-fetch ──
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type':   'application/json'
      },
      body: JSON.stringify({
        email,
        amount:       selectedPack.amount,
        reference,
        currency:     selectedPack.currency,
        callback_url: callbackUrl,
        metadata: {
          user_id,
          pack,
          plan:            pack,   // kept for older records
          credits:         selectedPack.credits,
          expected_amount: selectedPack.amount,
          on_launch_offer: selectedPack.on_launch_offer,
          product:         'Missolowo Slate'
        }
      })
    });

    const paystackData = await paystackRes.json();

    if (!paystackData.status) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: paystackData.message || 'Paystack initialisation failed' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        authorization_url: paystackData.data.authorization_url,
        reference:         paystackData.data.reference,
        access_code:       paystackData.data.access_code,
        pack,
        name:              selectedPack.name,
        credits:           selectedPack.credits,
        amount:            selectedPack.amount,
        currency:          selectedPack.currency,
        on_launch_offer:   selectedPack.on_launch_offer,
        callback_url:      callbackUrl
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Payment initiation failed: ' + error.message })
    };
  }
};
