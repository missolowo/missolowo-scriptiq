// The model is one setting. This holds it there.
//
//   node tests/model-probe.js
//
// 1. No function names a model. Every OpenAI call builds its body through
//    lib/slate-model.js, so SLATE_MODEL in Netlify is the only switch.
// 2. Each real call site — its text extracted from the shipped function and
//    run — produces a body the named model accepts: gpt-4o-mini (the
//    default), gpt-4.1-mini, gpt-6-luna (OpenAI's named replacement), and
//    gpt-5-mini (a reasoning model that refuses temperature and "none").
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'netlify/functions');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } }

const libPath = path.join(FN, 'lib/slate-model.js');
function freshLib() { delete require.cache[require.resolve(libPath)]; return require(libPath); }

// ── 1. Nothing hard-coded, every call routed ──
const SITES = { breakdown: 1, callsheet: 1, storyday: 1, schedule: 1 };
fs.readdirSync(FN).filter(f => f.endsWith('.js')).forEach(f => {
  const src = fs.readFileSync(path.join(FN, f), 'utf8');
  ok(!/model:\s*['"`]/.test(src), f + ' names a model in its own code');
  const calls = (src.match(/api\.openai\.com\/v1\/chat\/completions/g) || []).length;
  const routed = (src.match(/JSON\.stringify\(slateChatBody\(\{/g) || []).length;
  ok(calls === routed, f + ': ' + calls + ' OpenAI calls, ' + routed + ' through slateChatBody');
  const name = f.replace(/\.js$/, '');
  if (SITES[name]) ok(calls === SITES[name], f + ' should have ' + SITES[name] + ' OpenAI call(s), has ' + calls);
});

// ── 2. Each real call site, run under each model ──
function extract(src) {
  const a = src.indexOf('slateChatBody({') + 'slateChatBody('.length;
  let d = 0;
  for (let j = a; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(a, j + 1); }
  }
  throw new Error('unbalanced');
}
const stubs = { prompt: 'P', notePrompt: 'N', retry_english: false };

const MODELS = {
  '':              { tokens: 'max_tokens', temp: true,  effort: undefined },
  'gpt-4.1-mini':  { tokens: 'max_tokens', temp: true,  effort: undefined },
  'gpt-6-luna':    { tokens: 'max_completion_tokens', temp: true,  effort: 'none' },
  'gpt-5-mini':    { tokens: 'max_completion_tokens', temp: false, effort: 'minimal' },
  'o4-mini':       { tokens: 'max_completion_tokens', temp: false, effort: 'low' },
};

Object.keys(SITES).forEach(name => {
  const literal = extract(fs.readFileSync(path.join(FN, name + '.js'), 'utf8'));
  const original = new Function(...Object.keys(stubs), 'return ' + literal)(...Object.values(stubs));
  Object.keys(MODELS).forEach(m => {
    const want = MODELS[m];
    process.env.SLATE_MODEL = m;
    delete process.env.SLATE_REASONING_EFFORT;
    const { slateChatBody, DEFAULT_MODEL } = freshLib();
    const body = slateChatBody(original);
    const label = name + ' @ ' + (m || 'default');
    ok(body.model === (m || DEFAULT_MODEL), label + ': model is ' + body.model);
    ok(body.model !== undefined && !('model' in original), label + ': model comes from the setting, not the call');
    const budget = want.effort && want.effort !== 'none' ? original.max_tokens * 2 : original.max_tokens;
    ok(body[want.tokens] === budget, label + ': ' + want.tokens + ' = ' + body[want.tokens] + ', want ' + budget);
    const other = want.tokens === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    ok(!(other in body), label + ': must not send ' + other);
    ok(('temperature' in body) === want.temp, label + ': temperature ' + (want.temp ? 'kept' : 'dropped'));
    if (want.temp) ok(body.temperature === original.temperature, label + ': temperature unchanged');
    ok(body.reasoning_effort === want.effort, label + ': reasoning_effort ' + body.reasoning_effort);
    ok(JSON.stringify(body.messages) === JSON.stringify(original.messages), label + ': messages untouched');
    ok(JSON.stringify(body.response_format) === JSON.stringify(original.response_format), label + ': JSON mode kept');
  });
});

// ── 3. The override, and a blank setting ──
process.env.SLATE_MODEL = 'gpt-6-luna'; process.env.SLATE_REASONING_EFFORT = 'low';
let b = freshLib().slateChatBody({ max_tokens: 100, temperature: 0.1, messages: [] });
ok(b.reasoning_effort === 'low' && !('temperature' in b) && b.max_completion_tokens === 200, 'effort override: reasoning on drops temperature, doubles budget');
process.env.SLATE_MODEL = '   '; delete process.env.SLATE_REASONING_EFFORT;
b = freshLib().slateChatBody({ max_tokens: 100, temperature: 0.1, messages: [] });
ok(b.model === 'gpt-4o-mini', 'a blank SLATE_MODEL falls back to the default');
delete process.env.SLATE_MODEL;

// ── A run says which model read it ──
//
// SLATE_MODEL being one setting is what makes it safe to change, and what
// makes it impossible to tell from a document what produced it. Netlify
// only hands a function new environment values on a deploy, so "I changed
// it" and "it is running" are different facts — and a setting you cannot
// read back is a setting you cannot trust.
{
  const ROOT2 = path.resolve(__dirname, '..');
  const BD = fs.readFileSync(path.join(ROOT2, 'netlify/functions/breakdown.js'), 'utf8');
  const APPSRC = fs.readFileSync(path.join(ROOT2, 'app.html'), 'utf8');
  ok('the function returns the model it used',
     /breakdown\.slate_model = slateModel\(\);/.test(BD));
  ok('  ...from the same reader every call site uses',
     /const \{ slateChatBody, slateModel \} = require\('\.\/lib\/slate-model'\);/.test(BD),
     'a second reader of the setting is a second answer');
  ok('the merge records it on the run',
     /model: slateBreakdown\.slate_model \|\| ''/.test(APPSRC));
  ok('  ...beside the run id, not in slate_reading',
     !/slate_reading = \{[\s\S]{0,120}model:/.test(APPSRC),
     'every value in slate_reading is a number or a boolean so no '
     + 'screenplay text can reach it, and a guard with an exception is '
     + 'not a guard — merge-probe refused this and was right');
  ok('  ...taking the first chunk that carries one',
     /if \(!m && c && c\.slate_model\) m = String\(c\.slate_model\);/.test(APPSRC),
     'a resumed breakdown has chunks from before this field existed');
}

console.log('model-probe         ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
