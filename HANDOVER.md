# Missolowo Slate — Handover

Written 25 November 2026, for Elizabeth and for whoever helps her next.

This is the document to read first. It says how to run Slate, how to change
the things most likely to need changing, how to tell whether a change is
safe, and — honestly — what Slate still cannot do.

---

## 1. What is locked

Three modules are **locked** as of production `2c0cc89`. They are consistent
with each other and verified against five real screenplays and three live
runs of THE WEAVER'S DAUGHTER:

| Module | What it produces |
|---|---|
| **Script Breakdown** | Every scene, its elements, and Reports 1–5 |
| **Shooting Schedule** | The Board, the day-by-day, cast release, day out of days, department load |
| **Call Sheet** | One day: scenes, cast calls, locations, unit moves, tomorrow's advance |

Locked means: **do not change them to add features.** Fix a fault, verify it
the way section 7 describes, and leave everything else alone. Every bug this
month came from changing something that was already working.

---

## 2. Where everything lives

- **Repository** — `missolowo/missolowo-scriptiq` (public: never commit a key)
- **Working branch** — `v2-build`. All commits go here.
- **Production branch** — `production`, protected. Reached only by pull
  request from `v2-build`.
- **Site** — missolowo.com, deployed by Netlify from `production`.
- **Database** — Supabase project `ilkwsanblbsabtgipbom`.

### Publishing

1. Commit to `v2-build` and push. Each push costs a Netlify build credit, so
   batch commits and push only when something is ready.
2. Open a pull request from `v2-build` into `production` and wait for the
   Netlify check to pass.
3. Merge it (squash).
4. **Publish the deploy yourself in Netlify.** Auto-publishing is off, so
   merging to `production` does not put anything live.

After a squash merge, `git merge origin/production` back into `v2-build`
before the next change, or the next pull request will conflict. The conflict
is always the same shape — the squash rewrote identical content under a new
commit — and it is resolved in favour of `v2-build`. Always confirm nothing
was lost afterwards:

```
git diff origin/production -- app.html | grep -E "^-[^-]"
```

Every line it prints should be a change you meant to make.

---

## 3. Environment variables

Set in **Netlify → Site configuration → Environment variables**. Netlify
hands a function new values **only on a deploy**, so after changing one you
must publish a fresh deploy. *"I changed it"* and *"it is running"* are
different facts.

| Variable | What it does |
|---|---|
| `SLATE_MODEL` | Which OpenAI model reads scripts. Currently `gpt-6-luna`. Unset means `gpt-4o-mini`. |
| `SLATE_REASONING_EFFORT` | Optional, reasoning models only: `none`, `minimal`, `low`, `medium`, `high`. Passed to OpenAI unchecked, so a typo fails every breakdown. Unset is fine. |
| `OPENAI_API_KEY` | Required. Without it nothing reads a script. |
| `SUPABASE_SECRET_KEY` | Required. Productions, breakdowns, schedules, call sheets. |
| `PAYSTACK_SECRET_KEY` | Required for payment. |
| `OPS_METRICS_KEY` | Optional, the ops metrics endpoint. |
| `MAILERLITE_API_KEY`, `MAILERLITE_SIGNUP_GROUP_ID` | Optional, the signup hook. |

Secrets live **only** here. Never in a committed file — the repository is
public.

---

## 4. Changing the model

The most likely thing you will need to do without help.

1. Set `SLATE_MODEL` to the model name, exactly as OpenAI writes it.
2. Publish a fresh deploy.
3. **Run one script before trusting it**, then confirm what actually ran:

```sql
select production_elements->'slate_run'->>'id'    as run,
       production_elements->'slate_run'->>'model' as model,
       created_at
from breakdowns order by created_at desc limit 3;
```

If `model` says what you set, the change took.

**If breakdowns start failing after a model change**, the cause is almost
always the request shape. Recovery, in order, each taking one variable and a
republish:

1. Set `SLATE_REASONING_EFFORT` to `low`. This makes Slate stop sending
   `temperature`, which some models refuse.
2. If that fails too, set `SLATE_MODEL` back to `gpt-4o-mini`.

Neither needs a code change. `netlify/functions/lib/slate-model.js` shapes
every request for whichever model is named — newer models want
`max_completion_tokens` where `gpt-4o-mini` wants `max_tokens`, most refuse
`temperature`, and reasoning spends part of the answer's token budget. That
file is the only place the model is named; nothing else should ever name one.

---

## 5. Running the tests

From the repository root:

```
node tests/run.js          # ~2,215 assertions, must be 0 failed
node tests/page-load.js    # every page loads in a real browser
```

The browser checks, which need playwright and catch what assertions cannot:

```
node tests/layout-browser.js      a PDF page is a layout, not a stream
node tests/storyday-browser.js    the one inference, run against a 401
node tests/resume-browser.js      the resume offer at phone width
node tests/funnel-browser.js      the funnel events actually fire
node tests/homepage-browser.js    how far down the homepage people get
node tests/pagefurniture-browser.js   page numbers are not scene numbers
```

And the three sample PDFs on the homepage, which are not code but are a
promise about what Slate produces:

```
python3 tools/verify-sample-pdfs.py
```

It fails if a sample's page content is not the audited document, or if one
has lost its title. **If the samples are ever regenerated from a new run**,
audit the new ones, re-run `python3 tools/stamp-sample-pdfs.py` to put the
titles back, and update the recorded hashes in the verifier deliberately.

**Never merge anything with a failing assertion.** If a probe fails and you
believe the code is right, read the probe before changing it — roughly half
the time this month, the probe was right and the code was not.

---

## 6. What the probes protect

There are 37. You do not need to know them all, but these are the ones that
exist because something went wrong on a real production document:

- **`scope-probe`** — a function must exist where it is declared, not where a
  probe pastes it. Added after a nested function broke schedule generation
  for every script with a montage, while all other probes passed.
- **`merge-probe`** — the merge's derived lists, and the rule that
  `slate_reading` holds only numbers and booleans so no screenplay text can
  reach it. It has refused real mistakes. Do not add an exception to it.
- **`packer-probe`**, **`dayorder-probe`** — how a day is built and in what
  order it shoots: pages, light forward, one trip per location.
- **`montage-schedule-probe`** — a montage is one scene and several units of
  work, and its pages divide across its parts and must sum back to the scene.
- **`callsheet-guard-probe`** — what stops a bad call sheet leaving Slate.
- **`copy-probe`** — what Slate promises filmmakers, in the words they read.
  It enforces that Slate never asks a filmmaker for their screenplay.
- **`model-probe`** — the model is one setting and every call site obeys it.

---

## 7. How to verify a change

In this order. Skipping the last step is how most of this month's faults
reached a document.

1. **Find the actual cause**, not the place it surfaced. Twice this month a
   fix was made where the fault appeared and not anywhere else, and the same
   bug was still present two documents away.
2. **Run the full suite and the browser checks.**
3. **Render the document and look at it.** A clean assertion run has shipped
   a colour bar invisible on the page, a column heading above the wrong
   number, a page with no headings, and a day printed through its own rows.
   Extracted text is not enough either — rasterise the page and look:

```
pdftoppm -png -r 110 -f 3 -l 3 schedule.pdf page
```

4. **Check the documents agree with each other.** The breakdown and the
   schedule must report the same page count for the same film. They disagreed
   for a day and it was inventing a shoot day.

**Prompt changes are additive only.** Both November regressions came from
expanding and restricting a prompt's instructions in one commit.

---

## 8. What Slate cannot do

Honest list. Each is a real gap a professional will notice.

- **Story day is empty.** The inference pass runs and returns nothing on
  live scripts. There is no continuity report, so a script supervisor gets
  nothing from Slate. This is the largest remaining gap.
- **Company moves do not limit a day.** The packer budgets by page count and
  scene count, so it will put four locations in one day. It prints an
  advisory; a 1st AD would have split the day.
- **Call times are derived, not negotiated.** A sensible first draft from
  scene order, not a final call sheet.
- **No revision tracking.** Professional call sheets are versioned and
  colour-coded — white, blue, pink. Slate has a run ID. Hand out two versions
  of one day and nobody can tell which is current.
- **Production Details must be filled in.** Director, producer, 1st AD,
  hospital, base camp. A sheet with dashes in Key Contacts is not
  distributable, and that is data entry, not code.
- **Scene numbers come from the script.** A scene the writer never numbered
  prints as `—`, deliberately: a number Slate invented would be called down a
  phone and written on a clapperboard as though the writer chose it.
- **A montage's elements belong to the whole scene.** Its props, vehicles and
  cast are listed on every day it shoots, because the script does not say
  which part needs them. Both documents say so; confirm before booking.

---

## 9. When a breakdown looks wrong

Every run records what it read, which is how to answer this without guessing:

```sql
select production_elements->'slate_run'->>'id'    as run,
       production_elements->'slate_run'->>'model' as model,
       production_elements->'slate_reading'       as reading,
       jsonb_array_length(scenes) as scenes
from breakdowns order by created_at desc limit 1;
```

`slate_reading` answers the useful questions: how many headings were read off
the page, how many scenes the model returned, how many were rebuilt from the
page when the model missed them, whether every section agreed, and why the
story-day pass did nothing (`story_days_skipped` names the reason in one
word — `http_401`, `threw`, or a gate).

**Scenes cannot go missing.** The merge deletes the model's scene list and
rebuilds every scene from the headings on the page, so a model that times
out, drops a section or returns nonsense still yields a complete breakdown.
Measured on all five test screenplays: IRIRI 65/65, LORI NKAN MI 47/47, WHEN
LOVE FINDS YOU 18/18, THE HILLS BETWEEN US 86/86, iRANTI 115/115.

What it does *not* guarantee is that the page reader found every heading in
the first place. That is the honest limit of the claim.

---

## 10. Rules that keep this safe

- All commits to `v2-build`; `production` is protected; **never force-push.**
- The repository is public — no keys, ever, in any committed file.
- Never ask a filmmaker for their screenplay. `copy-probe` enforces it.
- No production database change without Elizabeth's written approval.
- Batch commits; each push to `v2-build` costs a build credit.
- Deploy previews do not load for Elizabeth — test on the published deploy.
- One person, or one session, on `v2-build` at a time. Two working in
  parallel on 25 November produced the same fix twice and a merge conflict.
