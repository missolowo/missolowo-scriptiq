// ============================================================
// MISSOLOWO SLATE — THE MODEL (single source of truth)
// ============================================================
// Which OpenAI model reads the scripts is ONE setting, and it is not
// in the code. Set it in Netlify:
//
//   Site configuration → Environment variables → SLATE_MODEL
//
// then publish a fresh deploy (Netlify only hands a function new
// environment values on a deploy). Leave it unset and Slate uses
// DEFAULT_MODEL below.
//
// Optional second setting, only for reasoning models (gpt-5*, gpt-6*,
// o-series):
//
//   SLATE_REASONING_EFFORT   none | minimal | low | medium | high
//
// Why this file does more than read a name: the newer models do not
// accept the request gpt-4o-mini accepts. They reject `max_tokens`
// (it is `max_completion_tokens`), most reject `temperature` unless
// reasoning is switched off, and by default they spend part of the
// token budget thinking — which on a 16,000-token breakdown can cut the
// JSON off mid-scene. Changing the name alone would have taken every
// breakdown, call sheet, story-day pass and schedule note down at once.
// So every call builds its request here, and the request is shaped for
// whichever model is named.
// ============================================================

const DEFAULT_MODEL = 'gpt-4o-mini';

function slateModel() {
  const v = String(process.env.SLATE_MODEL || '').trim();
  return v || DEFAULT_MODEL;
}

// Reasoning families: gpt-5, gpt-5.x, gpt-6*, o1/o3/o4…
function isReasoningModel(model) {
  return /^(gpt-[5-9]|o\d)/i.test(model);
}

// Families that accept reasoning_effort "none" — and, with it, temperature.
// gpt-5 / gpt-5-mini / gpt-5-nano (the August 2025 line) and o-series do not.
function acceptsNoReasoning(model) {
  return /^gpt-(6|5\.[1-9])/i.test(model);
}

function slateReasoningEffort(model) {
  const set = String(process.env.SLATE_REASONING_EFFORT || '').trim().toLowerCase();
  if (set) return set;
  // Slate's work is reading and filling in a record, not puzzling. Off
  // where the model allows it; the lightest setting where it does not.
  if (acceptsNoReasoning(model)) return 'none';
  if (/^o\d/i.test(model)) return 'low';
  return 'minimal';
}

// Every call site passes what it passed before — max_tokens, temperature,
// response_format, messages — and gets back a body the named model accepts.
function slateChatBody(opts) {
  const model = slateModel();
  const body = { model: model };

  if (!isReasoningModel(model)) {
    body.max_tokens = opts.max_tokens;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
  } else {
    const effort = slateReasoningEffort(model);
    body.reasoning_effort = effort;
    // Reasoning tokens come out of the same budget as the answer. With
    // reasoning on, double the budget so the answer is never the part cut.
    body.max_completion_tokens = effort === 'none' ? opts.max_tokens : opts.max_tokens * 2;
    // Temperature is only accepted with reasoning off, and only on the
    // families that can switch it off. Anywhere else it is a 400.
    if (effort === 'none' && /^gpt-6/i.test(model) && opts.temperature !== undefined) {
      body.temperature = opts.temperature;
    }
  }

  if (opts.response_format) body.response_format = opts.response_format;
  body.messages = opts.messages;
  return body;
}

module.exports = { DEFAULT_MODEL, slateModel, slateChatBody, isReasoningModel, slateReasoningEffort };
