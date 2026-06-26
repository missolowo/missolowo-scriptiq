// ============================================
// SCRIPTIQ — PAYMENT VERIFY
// Called after Paystack redirects filmmaker to
// https://missolowo-scriptiq.netlify.app/payment-success
//
// SECURITY RULES:
// 1. NEVER trust the frontend — always verify with Paystack servers
// 2. Check payment status is "success"
// 3. Verify amount matches expected plan price
// 4. Check reference was not already processed (prevent double credit)
// 5. ADD credits to existing balance — never overwrite
// ============================================

const fetch                     = require('node-fetch');
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');
const { createClient }          = require('@supabase/supabase-js');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';

// Expected amounts per plan in kobo (NGN × 100)
const PLAN_AMOUNTS = {
  starter: 250000,   // ₦2,500
  pro:     800000    // ₦8,000
};

// Credits per plan
const PLAN_CREDITS = {
  starter: 80,
  pro:     300
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
    const { reference, user_id } = JSON.parse(event.body);

    if (!reference) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payment reference is required' })
      };
    }

    // ── Rate limit — 10 verifications per IP per hour ──
    const clientIP = getClientIP(event);
    const rateLimit = await checkRateLimit(clientIP, 'payment-verify', 10, process.env.SUPABASE_SECRET_KEY, user_id || null);
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.resetAt, 'payment-verify');

    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
    const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;

    if (!PAYSTACK_SECRET || !SUPABASE_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

    // ══════════════════════════════════════════════
    // STEP 1 — Check reference was not already used
    // Prevents a filmmaker from refreshing the success
    // page and getting double credits
    // ══════════════════════════════════════════════
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id, status')
      .eq('reference', reference)
      .single();

    if (existingPayment && existingPayment.status === 'success') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success:  true,
          message:  'Payment already processed — credits have been added.',
          duplicate: true
        })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 2 — Verify with Paystack servers
    // node-fetch used here to avoid "fetch is not defined"
    // ══════════════════════════════════════════════
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method:  'GET',
        headers: { 'Authorization': `Bearer ${PAYSTACK_SECRET}` }
      }
    );

    const paystackData = await paystackRes.json();

    // ── Paystack call itself failed ──
    if (!paystackData.status) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error:   'Could not verify payment with Paystack',
          details: paystackData.message
        })
      };
    }

    const txn = paystackData.data;

    // ══════════════════════════════════════════════
    // STEP 3 — Confirm transaction status is "success"
    // ══════════════════════════════════════════════
    if (txn.status !== 'success') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error:   'Payment was not successful',
          status:  txn.status
        })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 4 — Extract metadata set during initiation
    // ══════════════════════════════════════════════
    const { plan, credits, user_id: meta_user_id, expected_amount } = txn.metadata || {};
    const uid = user_id || meta_user_id;

    if (!uid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not identify user from payment' })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 5 — Verify amount paid matches plan price
    // Prevents manipulation (e.g. paying ₦25 for Pro plan)
    // ══════════════════════════════════════════════
    const expectedAmount = expected_amount || PLAN_AMOUNTS[plan];
    if (expectedAmount && txn.amount !== expectedAmount) {
      // Log suspicious attempt
      await supabase.from('payments').insert({
        user_id:          uid,
        reference,
        amount:           txn.amount,
        currency:         'NGN',
        status:           'suspicious',
        plan:             plan || 'unknown',
        credits_added:    0,
        paystack_response: txn,
        created_at:       new Date().toISOString()
      });

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error:    'Payment amount mismatch',
          expected: expectedAmount,
          received: txn.amount
        })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 6 — Get current user credits from Supabase
    // ══════════════════════════════════════════════
    const creditsToAdd   = credits || PLAN_CREDITS[plan] || 0;
    const planName       = plan   || 'starter';

    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('credits_remaining, credits_used, role')
      .eq('id', uid)
      .single();

    if (userError || !currentUser) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found in database' })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 7 — ADD credits to existing balance
    // NEVER overwrite — always ADD on top of what they have
    // Example: user had 5 free credits left → now has 5 + 80 = 85
    // ══════════════════════════════════════════════
    const newCreditsRemaining = (currentUser.credits_remaining || 0) + creditsToAdd;

    const { error: updateError } = await supabase
      .from('users')
      .update({
        role:                  'paid',
        subscription_status:   'active',
        subscription_plan:     planName,
        credits_remaining:     newCreditsRemaining,
        credits_used:          currentUser.credits_used || 0,
        updated_at:            new Date().toISOString()
      })
      .eq('id', uid);

    if (updateError) {
      throw new Error('Failed to update user credits: ' + updateError.message);
    }

    // ══════════════════════════════════════════════
    // STEP 8 — Save payment record to Supabase
    // ══════════════════════════════════════════════
    await supabase.from('payments').insert({
      user_id:           uid,
      reference,
      amount:            txn.amount,
      currency:          'NGN',
      status:            'success',
      plan:              planName,
      credits_added:     creditsToAdd,
      paystack_response: txn,
      created_at:        new Date().toISOString()
    });

    // ══════════════════════════════════════════════
    // STEP 9 — Return success to frontend
    // ══════════════════════════════════════════════
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:           true,
        message:           `Payment verified! ${creditsToAdd} credits added to your account.`,
        plan:              planName,
        credits_added:     creditsToAdd,
        credits_remaining: newCreditsRemaining
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Verification failed: ' + error.message })
    };
  }
};
