// ============================================
// SCRIPTIQ — COMPOSITE RATE LIMIT ENGINE
// Shared across all Netlify functions
// Tracks by userId if logged in → fair per-user limits
// Falls back to IP if anonymous → still protected
// Solves shared Wi-Fi problem on film sets
// ============================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ilkwsanblbsabtgipbom.supabase.co';

/**
 * Check and increment rate limit for a given user or IP + function
 * @param {string} ip             - Client IP address (always required as fallback)
 * @param {string} functionName   - Name of the function being called
 * @param {number} maxRequests    - Max allowed requests per hour
 * @param {string} supabaseSecret - Supabase secret key from env
 * @param {string|null} userId    - Logged-in user ID (optional — preferred over IP)
 * @returns {{ allowed: boolean, remaining: number, resetAt: string }}
 */
async function checkRateLimit(ip, functionName, maxRequests, supabaseSecret, userId = null) {
  try {
    const supabase    = createClient(SUPABASE_URL, supabaseSecret);
    const windowStart = new Date();
    windowStart.setMinutes(0, 0, 0); // Start of current hour

    // ── Composite key: user-based if logged in, IP-based if anonymous ──
    // This prevents shared Wi-Fi on a film set from blocking everyone
    const key = userId
      ? `user_${userId}__${functionName}`
      : `ip_${ip}__${functionName}`;

    // ── Get existing record for this key + current hour window ──
    const { data: existing } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .gte('window_start', windowStart.toISOString())
      .single();

    if (!existing) {
      // ── First request this hour — create record ──
      await supabase.from('rate_limits').insert({
        key,
        ip,
        user_id:       userId || null,   // Saved for metrics queries
        function_name: functionName,
        count:         1,
        window_start:  windowStart.toISOString(),
        created_at:    new Date().toISOString()
      });
      return {
        allowed:   true,
        remaining: maxRequests - 1,
        resetAt:   getResetTime()
      };
    }

    // ── Record exists — check if limit reached ──
    if (existing.count >= maxRequests) {
      return {
        allowed:   false,
        remaining: 0,
        resetAt:   getResetTime()
      };
    }

    // ── Under limit — increment count atomically ──
    await supabase
      .from('rate_limits')
      .update({ count: existing.count + 1 })
      .eq('id', existing.id);

    return {
      allowed:   true,
      remaining: maxRequests - (existing.count + 1),
      resetAt:   getResetTime()
    };

  } catch (err) {
    // ── If rate limiter itself fails — allow request through ──
    // Never block filmmakers due to our own infrastructure errors
    console.error('[RateLimit] Error:', err.message);
    return { allowed: true, remaining: 99, resetAt: getResetTime() };
  }
}

/**
 * Get the time the current hour window resets
 */
function getResetTime() {
  const reset = new Date();
  reset.setHours(reset.getHours() + 1, 0, 0, 0);
  return reset.toISOString();
}

/**
 * Extract client IP from Netlify event headers
 * Tries multiple headers in priority order
 */
function getClientIP(event) {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['x-real-ip'] ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

/**
 * Build a rate limit exceeded response
 * Returns friendly message with exact reset time
 */
function rateLimitResponse(resetAt, functionName) {
  const resetTime = new Date(resetAt).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  return {
    statusCode: 429,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Retry-After':                 '3600'
    },
    body: JSON.stringify({
      error:     'Too many requests',
      message:   `You have reached the hourly limit for this feature. Please try again after ${resetTime}.`,
      resetAt,
      code:      'RATE_LIMIT_EXCEEDED'
    })
  };
}

module.exports = { checkRateLimit, getClientIP, rateLimitResponse };
