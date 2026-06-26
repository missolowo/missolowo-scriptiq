const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

async function checkRateLimit(ip, functionName, maxRequests, supabaseSecret, userId = null) {
  try {
    const supabase = createClient(SUPABASE_URL, supabaseSecret);
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0);

    const key = userId
      ? `user_${userId}__${functionName}`
      : `ip_${ip}__${functionName}`;

    const { data: existing } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .gte('window_start', windowStart.toISOString())
      .single();

    if (!existing) {
      await supabase.from('rate_limits').insert({
        key,
        ip,
        user_id: userId || null,
        function_name: functionName,
        count: 1,
        window_start: windowStart.toISOString(),
        created_at: new Date().toISOString()
      });
      return { allowed: true, remaining: maxRequests - 1, resetAt: getResetTime() };
    }

    if (existing.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: getResetTime() };
    }

    await supabase
      .from('rate_limits')
      .update({ count: existing.count + 1 })
      .eq('id', existing.id);

    return { allowed: true, remaining: maxRequests - (existing.count + 1), resetAt: getResetTime() };

  } catch (err) {
    console.error('[RateLimit] Error:', err.message);
    return { allowed: true, remaining: 99, resetAt: getResetTime() };
  }
}

function getResetTime() {
  const reset = new Date();
  reset.setHours(reset.getHours() + 1, 0, 0, 0);
  return reset.toISOString();
}

function getClientIP(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['x-real-ip'] ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

function rateLimitResponse(resetAt, functionName) {
  const resetTime = new Date(resetAt).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '
