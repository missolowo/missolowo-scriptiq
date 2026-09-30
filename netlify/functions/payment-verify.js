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

const fetch = (() => {
  try { return require('node-fetch'); }
  catch (e) { return global.fetch; }
})();
const { checkRateLimit, getClientIP, rateLimitResponse } = require('./rate-limiter');
const { createClient }          = require('@supabase/supabase-js');

const { PACKS, amountIsValidFor } = require('./lib/slate-pricing');

const SUPABASE_URL    = 'https://ilkwsanblbsabtgipbom.supabase.co';

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
    // STEP 1 — Has this reference already been credited?
    // A first look, to answer fast. It is NOT what prevents double
    // credits — two calls arriving together would both read "no" here.
    // The real guard is the unique index on payments.reference, claimed
    // in STEP 6 before any credit is added.
    // ══════════════════════════════════════════════
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id, status, credits_added')
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
    const meta = txn.metadata || {};
    const packKey = meta.pack || meta.plan;
    const uid = user_id || meta.user_id;

    if (!uid) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Could not identify user from payment' })
      };
    }

    // ══════════════════════════════════════════════
    // STEP 5 — Does the amount paid match this pack's price?
    // Checked against the pricing file, not against a figure carried
    // in the payment metadata — metadata travels through Paystack and
    // should not be the only authority on what we charge.
    //
    // EITHER price is accepted. A customer quoted the launch price and
    // charged it must not be refused because the 100th customer paid
    // while their payment page was open.
    // ══════════════════════════════════════════════
    if (!packKey || !PACKS[packKey] || !amountIsValidFor(packKey, txn.amount)) {
      // Log suspicious attempt
      await supabase.from('payments').insert({
        user_id:          uid,
        reference,
        amount:           txn.amount,
        currency:         'NGN',
        status:           'suspicious',
        plan:             packKey || 'unknown',
        credits_added:    0,
        paystack_response: txn,
        created_at:       new Date().toISOString()
      });

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error:    'Payment amount does not match this pack',
          pack:     packKey || 'unknown',
          received: txn.amount
        })
      };
    }

    // Credits and pack name come from the pricing file, keyed by pack —
    // never from the metadata, which travels through Paystack and could
    // carry a figure from an older deploy.
    const creditsToAdd = PACKS[packKey].credits;
    const planName     = packKey;

    // ══════════════════════════════════════════════
    // STEP 6 — CLAIM THIS PAYMENT BEFORE CREDITING IT
    // ══════════════════════════════════════════════
    // This is what actually prevents double credits.
    //
    // The old order was: check for an existing row, add credits, then
    // record the payment. Three separate steps. Paystack can call this
    // twice — the redirect and a webhook, or a customer refreshing the
    // success page — and two calls arriving together would BOTH read
    // "no existing payment", BOTH add credits, and both insert.
    //
    // Now the row is inserted FIRST. payments.reference carries a unique
    // index, so the second insert is rejected by the database and that
    // call credits nothing. The database decides, not a sequence of
    // reads and writes that can interleave.
    const { error: claimError } = await supabase.from('payments').insert({
      user_id:           uid,
      reference,
      amount:            txn.amount,
      currency:          txn.currency || 'NGN',
      status:            'processing',
      plan:              planName,
      credits_added:     0,
      paystack_response: txn,
      created_at:        new Date().toISOString()
    });

    if (claimError) {
      // 23505 is postgres for "unique constraint violated" — another
      // call already claimed this reference. It is crediting, or has
      // credited. Either way this call must not add credits.
      if (claimError.code === '23505' || /duplicate key/i.test(claimError.message || '')) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success:   true,
            message:   'Payment already processed — credits have been added.',
            duplicate: true
          })
        };
      }
      throw new Error('Could not record payment: ' + claimError.message);
    }

    // ══════════════════════════════════════════════
    // STEP 7 — Read the balance, then ADD to it
    // Never overwrite: 2 free credits left plus a 5-credit pack is 7.
    // ══════════════════════════════════════════════
    const { data: currentUser, error: userError } = await supabase
      .from('users')
      .select('credits_remaining, credits_used, role')
      .eq('id', uid)
      .single();

    if (userError || !currentUser) {
      // The payment is real and claimed, but we cannot find the user.
      // Mark it so it shows up for reconciliation rather than vanishing.
      await supabase.from('payments')
        .update({ status: 'unmatched_user', updated_at: new Date().toISOString() })
        .eq('reference', reference);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment received, but the account could not be found. Please contact support with your reference: ' + reference })
      };
    }

    const newCreditsRemaining = (currentUser.credits_remaining || 0) + creditsToAdd;

    const { error: updateError } = await supabase
      .from('users')
      .update({
        role:              'paid',
        credits_remaining: newCreditsRemaining,
        updated_at:        new Date().toISOString()
      })
      .eq('id', uid);

    if (updateError) {
      await supabase.from('payments')
        .update({ status: 'credit_failed', updated_at: new Date().toISOString() })
        .eq('reference', reference);
      throw new Error('Payment recorded but credits could not be added: ' + updateError.message);
    }

    // ══════════════════════════════════════════════
    // STEP 8 — Mark the claim complete
    // A row left at "processing" means the credits may not have landed,
    // and is a reconciliation job rather than a silent loss.
    // ══════════════════════════════════════════════
    await supabase.from('payments')
      .update({
        status:        'success',
        credits_added: creditsToAdd,
        updated_at:    new Date().toISOString()
      })
      .eq('reference', reference);

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
