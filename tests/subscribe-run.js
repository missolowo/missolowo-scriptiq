// subscribe.js, actually run.
//
//   node tests/subscribe-run.js
//
// subscribe-probe proves the code is SHAPED right. This runs the handler
// with Supabase and MailerLite both stubbed, and reads what comes out: the
// status it answers, and the exact body it would have sent.
//
// The case worth the whole file is the second one. MailerLite is made to
// fail, and the handler must still answer 200 — because the browser does
// not await this, and a filmmaker who has just created an account must
// never see a failure that belongs to our email provider. Asserting that
// from the source alone is asserting about a regex; here it is observed.
const __p = require('path');
const Module = require('module');

const ROOT = __p.resolve(__dirname, '..');
const FNDIR = __p.join(ROOT, 'netlify', 'functions');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));

// ── Stubs ──
// A Supabase client that answers only what subscribe.js asks of it: who
// the token belongs to, and that user's name and signup time.
const ACCOUNT_CREATED = '2026-11-07T14:18:00.000Z';
function stubSupabase(profile) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    single() { return Promise.resolve({ data: profile }); },
    upsert() { return Promise.resolve({ data: null }); },
    insert() { return Promise.resolve({ data: null }); },
    update() { return chain; },
    is() { return chain; }
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } }, error: null }) },
    from: () => chain
  };
}

// Intercept the two modules subscribe.js and rate-limiter.js load, so no
// network or database is touched by this test.
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => stubSupabase(global.__profile) };
  }
  if (request === './rate-limiter') {
    return {
      checkRateLimit: () => Promise.resolve({ allowed: true }),
      getClientIP: () => '102.89.23.7',
      rateLimitResponse: () => ({ statusCode: 429, body: '{}' })
    };
  }
  if (request === './lib/slate-core') {
    return {
      slateAuthenticate: () => Promise.resolve({
        ok: true, user: { id: 'u-1', email: 'test@example.com', role: 'free' }
      })
    };
  }
  return realLoad(request, parent, isMain);
};

const EVENT = {
  httpMethod: 'POST',
  headers: { authorization: 'Bearer fake-token' },
  body: JSON.stringify({ email: 'attacker@example.com', name: 'Someone Else' })
};

function freshHandler() {
  delete require.cache[__p.join(FNDIR, 'subscribe.js')];
  return require(__p.join(FNDIR, 'subscribe.js')).handler;
}

(async () => {
  // ══════════════════════════════════════════════════
  console.log('\nWith no MailerLite key configured');
  {
    delete process.env.MAILERLITE_API_KEY;
    delete process.env.MAILERLITE_SIGNUP_GROUP_ID;
    global.__profile = { full_name: 'Ada Obi', created_at: ACCOUNT_CREATED };
    global.fetch = () => { throw new Error('fetch must not be called'); };

    const res = await freshHandler()(EVENT);
    ok('answers 200', res.statusCode === 200, String(res.statusCode));
    ok('  ...and reports that nothing was sent',
       JSON.parse(res.body).sent === false, res.body);
  }

  // ══════════════════════════════════════════════════
  console.log('\nWith a key, and MailerLite accepting');
  let sentBody = null;
  {
    process.env.MAILERLITE_API_KEY = 'test-key-not-real';
    process.env.MAILERLITE_SIGNUP_GROUP_ID = '204401524726564840';
    global.__profile = { full_name: 'Ada Obi', created_at: ACCOUNT_CREATED };
    global.fetch = (url, opts) => {
      sentBody = { url: url, headers: opts.headers, body: JSON.parse(opts.body) };
      return Promise.resolve({ ok: true, status: 201 });
    };

    const res = await freshHandler()(EVENT);
    ok('answers 200', res.statusCode === 200, String(res.statusCode));
    ok('  ...and reports it sent', JSON.parse(res.body).sent === true, res.body);

    ok('it called the MailerLite subscribers endpoint',
       sentBody.url === 'https://connect.mailerlite.com/api/subscribers', sentBody.url);
    ok('the key went in the Authorization header',
       sentBody.headers.Authorization === 'Bearer test-key-not-real');

    console.log('\n  the body it sent:\n  ' + JSON.stringify(sentBody.body, null, 2)
      .split('\n').join('\n  '));

    ok('THE EMAIL IS THE TOKEN HOLDER, not the one in the request body',
       sentBody.body.email === 'test@example.com',
       sentBody.body.email + ' — the request asked for attacker@example.com');
    ok('  ...and the name is not the one in the request body either',
       sentBody.body.fields.name === 'Ada Obi', sentBody.body.fields.name);
    ok('the group is the one configured',
       sentBody.body.groups[0] === '204401524726564840',
       JSON.stringify(sentBody.body.groups));
    ok('the notice version is recorded',
       sentBody.body.fields.signup_notice_version === 'v1-2026-11-17',
       sentBody.body.fields.signup_notice_version);
    ok('subscribed_at is the ACCOUNT time, in MailerLite format',
       sentBody.body.subscribed_at === '2026-11-07 14:18:00',
       sentBody.body.subscribed_at);
    ok('  ...with no T and no Z, which MailerLite rejects',
       !/[TZ]/.test(sentBody.body.subscribed_at), sentBody.body.subscribed_at);
    ok('the signup IP is recorded',
       sentBody.body.ip_address === '102.89.23.7', sentBody.body.ip_address);
  }

  // ══════════════════════════════════════════════════
  console.log('\nWith MailerLite REFUSING — the case that matters');
  {
    global.fetch = () => Promise.resolve({ ok: false, status: 422 });
    const res = await freshHandler()(EVENT);
    ok('still answers 200', res.statusCode === 200, String(res.statusCode));
    ok('  ...and says it did not send', JSON.parse(res.body).sent === false, res.body);
  }

  console.log('\nWith MailerLite unreachable');
  {
    global.fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const res = await freshHandler()(EVENT);
    ok('still answers 200', res.statusCode === 200, String(res.statusCode));
    ok('  ...and says it did not send', JSON.parse(res.body).sent === false, res.body);
  }

  console.log('\nWith MailerLite hanging for ever');
  {
    global.fetch = (url, opts) => new Promise((resolve, reject) => {
      if (opts.signal) opts.signal.addEventListener('abort',
        () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const started = Date.now();
    const res = await freshHandler()(EVENT);
    const took = Date.now() - started;
    ok('still answers 200', res.statusCode === 200, String(res.statusCode));
    ok('  ...and gives up inside six seconds', took < 6000, took + 'ms');
  }

  // ══════════════════════════════════════════════════
  console.log('\nA filmmaker who gave no name');
  {
    global.__profile = { full_name: '', created_at: ACCOUNT_CREATED };
    global.fetch = (url, opts) => {
      sentBody = { body: JSON.parse(opts.body) };
      return Promise.resolve({ ok: true, status: 201 });
    };
    const res = await freshHandler()(EVENT);
    ok('answers 200', res.statusCode === 200);
    ok('NO name field is sent at all',
       !('name' in sentBody.body.fields),
       JSON.stringify(sentBody.body.fields) + ' — an empty string reads as "Hi ,"');
    ok('  ...but the notice version still is',
       sentBody.body.fields.signup_notice_version === 'v1-2026-11-17');
  }

  console.log('\nA name with only spaces is the same as no name');
  {
    global.__profile = { full_name: '   ', created_at: ACCOUNT_CREATED };
    await freshHandler()(EVENT);
    ok('still no name field', !('name' in sentBody.body.fields),
       JSON.stringify(sentBody.body.fields));
  }

  console.log('\nA GET is refused');
  {
    const res = await freshHandler()({ httpMethod: 'GET', headers: {} });
    ok('405, not 200', res.statusCode === 405, String(res.statusCode));
  }

  Module._load = realLoad;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
