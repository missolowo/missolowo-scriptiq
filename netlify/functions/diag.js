// ============================================
// TEMPORARY DIAGNOSTIC — delete before launch.
// Visit /.netlify/functions/diag on the deploy preview.
// Reports which module fails to load, and why, without
// needing the Netlify function log.
// ============================================

exports.handler = async function () {
  const results = {};

  function attempt(label, fn) {
    try {
      const out = fn();
      results[label] = out === undefined ? 'ok' : out;
    } catch (err) {
      results[label] = 'FAILED: ' + (err && err.message ? err.message : String(err));
      if (err && err.code) results[label + '__code'] = err.code;
    }
  }

  // Node version — tells us whether global fetch exists
  results.node_version = process.version;
  results.global_fetch = (typeof fetch === 'function') ? 'available' : 'MISSING';

  // Environment variables — presence only, never the values
  results.env_SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ? 'set' : 'MISSING';
  results.env_OPENAI_API_KEY      = process.env.OPENAI_API_KEY      ? 'set' : 'MISSING';

  // Dependencies
  attempt('require_supabase', () => { require('@supabase/supabase-js'); });
  attempt('require_node_fetch', () => { require('node-fetch'); });

  // The shared module we just repaired
  attempt('require_rate_limiter', () => {
    const m = require('./rate-limiter');
    return 'ok — exports: ' + Object.keys(m).join(', ');
  });

  // The real test: load the failing functions and capture the crash
  attempt('load_schedule', () => {
    const m = require('./schedule');
    return typeof m.handler === 'function' ? 'ok — handler present' : 'loaded but NO handler export';
  });

  attempt('load_callsheet', () => {
    const m = require('./callsheet');
    return typeof m.handler === 'function' ? 'ok — handler present' : 'loaded but NO handler export';
  });

  attempt('load_breakdown', () => {
    const m = require('./breakdown');
    return typeof m.handler === 'function' ? 'ok — handler present' : 'loaded but NO handler export';
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(results, null, 2)
  };
};
