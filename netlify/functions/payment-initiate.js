// ============================================
// SCRIPTIQ — PAYMENT INITIATE
// Uses node-fetch to avoid "fetch is not defined"
// on Netlify Node.js environments
// ============================================

const fetch = require('node-fetch');
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');

const PLANS = {
  starter: { amount: 250000, credits: 80,  name: 'ScriptIQ Starter — 80 Credits' },
  pro:     { amount: 800000, credits: 300, name: 'ScriptIQ Pro — 300 Credits'    }
};

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
    const { email, plan, user_id } = JSON.parse(event.body);

    // ── Validate inputs ──
    if (!email || !plan || !user_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'email, plan and user_id are required' })
      };
    }

    // ── Rate limit — 10 payment initiations per IP per hour ──
    const clientIP = getClientIP(event);
    const rateLimit = await checkRateLimit(clientIP, 'payment-initiate', 10, process.env.SUPABASE_SECRET_KEY, user_id || null);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'payment-initiate');

    const selectedPlan = PLANS[plan];
    if (!selectedPlan) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Invalid plan "${plan}". Must be "starter" or "pro"` })
      };
    }

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Payment system not configured' })
      };
    }

    // ── Build a unique, traceable reference ──
    const reference = `scriptiq_${plan}_${user_id}_${Date.now()}`;

    // ── Call Paystack using node-fetch ──
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type':   'application/json'
      },
      body: JSON.stringify({
        email,
        amount:       selectedPlan.amount,
        reference,
        currency:     'NGN',
        callback_url: 'https://missolowo-scriptiq.netlify.app/payment-success',
        metadata: {
          user_id,
          plan,
          credits:        selectedPlan.credits,
          expected_amount: selectedPlan.amount,
          product:        'ScriptIQ'
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
        plan,
        credits:           selectedPlan.credits,
        amount:            selectedPlan.amount
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
