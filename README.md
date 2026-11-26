# Missolowo Slate

Pre-production for Nollywood: a screenplay goes in and a script breakdown,
shooting schedule and call sheet come out.

This README tells you how to run Slate on your own: the settings, how to
change the model, how to run the tests, what the tests protect, and what
Slate still can't do. `HANDOVER.md` has the longer story behind each rule.

Last checked against `production` at `09cfe80`, 26 November 2026.

---

## The one rule

**Script Breakdown, Shooting Schedule and Call Sheet are locked.**

Don't change them to add features. If something is broken, fix that one
fault, verify it (see "Before you merge anything"), and leave everything else
alone. Every bug in November came from changing something that already worked.

---

## Where things live

| What | Where |
|---|---|
| Code | `missolowo/missolowo-scriptiq`. **The repo is public. Never commit a key.** |
| Working branch | `v2-build`. All commits go here. |
| Live branch | `production` (protected). Changes reach it only through a pull request from `v2-build`. |
| Site | missolowo.com, built by Netlify from `production` |
| Database | Supabase project `ilkwsanblbsabtgipbom` |

### Shipping a change

1. Commit to `v2-build`. Push only when the work is ready, because every push
   uses a Netlify build credit.
2. Open a pull request from `v2-build` to `production` and wait for the
   Netlify check to go green.
3. Squash-merge it.
4. **Publish the deploy yourself in Netlify.** Auto-publish is off, so merging
   doesn't put anything live.
5. Test on the published site at missolowo.com. Deploy previews don't load
   for you.
6. Bring `v2-build` back in line before you start the next change:

   ```
   git checkout v2-build
   git merge origin/production      # any conflict: keep the v2-build side
   git diff origin/production -- app.html | grep -E "^-[^-]"
   ```

   Every line the last command prints should be a change you meant to make.

Only one person or session should work on `v2-build` at a time. Never
force-push.

---

## Environment variables

Set these in **Netlify → Site configuration → Environment variables**.

> **A new value does nothing until you publish a fresh deploy.** Netlify only
> hands values to the functions on a deploy. Changing a value and having it
> running are two separate steps.

| Variable | Needed? | What it does |
|---|---|---|
| `OPENAI_API_KEY` | **Required** | Without it, no script gets read. |
| `SUPABASE_SECRET_KEY` | **Required** | Productions, breakdowns, schedules and call sheets are all stored with it. |
| `PAYSTACK_SECRET_KEY` | **Required** | Payments. |
| `SLATE_MODEL` | Optional | The OpenAI model that reads scripts. Currently `gpt-6-luna`. If you leave it unset, Slate uses `gpt-4o-mini`. |
| `SLATE_REASONING_EFFORT` | Optional | Reasoning models only. Leave it unset unless a model change goes wrong (see below). |
| `OPS_METRICS_KEY` | Optional | Protects the ops metrics endpoint. |
| `MAILERLITE_API_KEY` | Optional | The signup → MailerLite hook. |
| `MAILERLITE_SIGNUP_GROUP_ID` | Optional | The MailerLite group signups join. |

Secrets go here and nowhere else.

---

## Changing the model

This is the change you're most likely to make on your own, and it needs no
code.

1. In Netlify, set `SLATE_MODEL` to the model name, spelled exactly the way
   OpenAI writes it.
2. **Publish a fresh deploy.**
3. Run one real script through Slate.
4. Check which model actually ran (Supabase → SQL editor):

   ```sql
   select production_elements->'slate_run'->>'id'    as run,
          production_elements->'slate_run'->>'model' as model,
          created_at
   from breakdowns order by created_at desc limit 3;
   ```

   If `model` shows the name you set, the change worked. If it shows the old
   name, the deploy didn't publish.

### If breakdowns start failing after a model change

The cause is almost always that the new model refuses the shape of Slate's
request. Try these in order, and republish after each one:

1. **Set `SLATE_REASONING_EFFORT` to `low`.** This turns reasoning on, and
   Slate then stops sending `temperature`, which most newer models refuse.
2. **If it still fails, set `SLATE_MODEL` back to `gpt-4o-mini`** and delete
   `SLATE_REASONING_EFFORT`.

Slate passes `SLATE_REASONING_EFFORT` straight to OpenAI without checking it,
so a typo will make every breakdown fail. The values the code expects are
`none`, `minimal`, `low`, `medium` and `high`. If you leave it unset, Slate
picks the lightest setting the model allows.

`netlify/functions/lib/slate-model.js` is the only place a model is named.
It shapes each request for whichever model you set (`max_completion_tokens`
or `max_tokens`, whether to send temperature, the reasoning setting).
Nothing else in the code should ever name a model, and `model-probe` fails if
something does.

---

## Running the tests

From the repository root:

```
node tests/run.js          # all 37 probes, ~2,215 assertions. Must end with 0 failed.
node tests/page-load.js    # every page loads in a real browser
```

These browser checks need Playwright. They catch problems that assertions
can't:

| Command | What it checks |
|---|---|
| `node tests/layout-browser.js` | Each PDF page is laid out properly, not dumped as one long stream |
| `node tests/pagefurniture-browser.js` | Page numbers don't get mixed up with scene numbers |
| `node tests/storyday-browser.js` | What the story-day pass does when OpenAI refuses it (401) |
| `node tests/resume-browser.js` | The offer to resume an interrupted breakdown, at phone width |
| `node tests/funnel-browser.js` | Funnel analytics events actually fire |
| `node tests/homepage-browser.js` | How far down the homepage people scroll |

**Never merge with a failing assertion.** If a probe fails and you think the
code is right, read the probe before you change it. About half the time in
November, the probe was right and the code was wrong.

---

## What each probe protects

All 37 run from `tests/run.js`. The ones in **bold** were added after a real
fault reached a real document, so treat them as the most important.

### Reading the script (Breakdown)

| Probe | Protects |
|---|---|
| **`merge-probe`** | The merge builds every scene from the headings on the page, so scenes can't go missing. It also enforces that `slate_reading` holds only numbers and booleans, so no screenplay text can leak into it. **Don't add exceptions to it.** |
| `align-probe` | The model's scenes get matched to the script's own headings. |
| `splitter-probe` | What the model is shown, and how the script is cut into pieces. |
| `prompt-probe` | What the model is paid to do, as opposed to what Slate works out itself. |
| `cast-probe` | Who counts as one person, who counts as two, and what isn't a person. |
| `korean-probe` | A scene heading with no INT/EXT word in it. |
| `language-probe` | One name per language, wherever it's written. |
| `numbering-probe` | What the `#` means, and that Slate says so. |
| `scenenumber-probe` | A number alone on a line: whether it's a scene number and whose. |
| `unnumbered-probe` | A scene the writer never numbered prints as `—`, never as an invented number. |
| `retry-probe` | Recovering from a connection that drops mid-breakdown. |
| `resume-probe` | An interrupted breakdown picks up where it stopped and is charged once. |
| `provenance-probe` | Every document can be traced to the run that produced it. |
| **`model-probe`** | The model is one setting, and every OpenAI call follows it. |

### Story day and continuity

| Probe | Protects |
|---|---|
| `storyday-probe` | The continuity key: read once, shown everywhere. |
| `storyday-pass-probe` | The one place Slate guesses, and how that guess is kept contained. |
| `continuity-probe` | Which scenes have to match each other. |

### Building the schedule (Schedule)

| Probe | Protects |
|---|---|
| **`packer-probe`** | How a shoot day is built: page budget, daylight, conservation. |
| **`dayorder-probe`** | The order a day is shot in: light forward, one trip per location. |
| **`montage-schedule-probe`** | A montage is one scene with several units of work. Its pages divide across the parts and must add back up to the scene. |
| `background-probe` | Background actors are counted once per scene, not once per montage part. |
| `department-probe` | What each department brings, and on which day. |
| `stripboard-probe` | The strip colours a crew already knows, and what gets no colour. |
| `derive-probe` | Everything that follows when a scene is assigned to a day. |
| `assign-probe` | Accepting, and refusing, a day assignment. |
| `move-probe` | What the workspace sends when a scene is moved. |
| `compromise-probe` | Advisories report a problem and never change the schedule. |

### Call sheet

| Probe | Protects |
|---|---|
| **`callsheet-guard-probe`** | What stops a bad call sheet from leaving Slate. |
| `calltime-probe` | Nobody is called after the scene they open the day with. |
| `logistics-probe` | What a unit needs to find the day (locations, moves). |

### Money, copy and accounts

| Probe | Protects |
|---|---|
| **`copy-probe`** | What Slate promises filmmakers, in the words they read. It enforces that **Slate never asks a filmmaker for their screenplay.** |
| `pricing-probe` | The three copies of each price still agree. |
| `charge-probe` | The credit is claimed before it is taken. |
| `isolation-probe` | One production's details never reach another production. |
| `funnel-probe` | Where people who started but didn't finish a breakdown dropped off. |
| `subscribe-probe` | The signup → MailerLite hook, kept isolated so it can't break signup. |

### The code itself

| Probe | Protects |
|---|---|
| **`scope-probe`** | A function exists where it's declared, not just where a probe pastes it in. This was added after a nested function broke scheduling for every script with a montage while every other probe passed. |

---

## Before you merge anything

Follow these steps in order. Skipping the last two is how most of November's
faults got into documents.

1. **Find the actual cause**, not just the place the fault showed up. Then
   look for the same bug everywhere else it could be. Twice, a fix was made
   in one place and the same bug was still live two documents away.
2. **Run `tests/run.js` and the browser checks.**
3. **Render the document and look at it.** Reading the extracted text isn't
   enough. Rasterise the page:

   ```
   pdftoppm -png -r 110 -f 3 -l 3 schedule.pdf page
   ```

   Passing assertions have still shipped an invisible colour bar, a heading
   over the wrong column, and a day printed on top of its own rows.
4. **Check that the documents agree.** The breakdown and the schedule must
   give the same page count for the same film.

**Prompt changes are additive only.** Never expand and restrict a prompt's
instructions in the same commit. Both November regressions came from doing
that.

---

## When a breakdown looks wrong

Every run records what it read. Check that before guessing:

```sql
select production_elements->'slate_run'->>'id'    as run,
       production_elements->'slate_run'->>'model' as model,
       production_elements->'slate_reading'       as reading,
       jsonb_array_length(scenes) as scenes
from breakdowns order by created_at desc limit 1;
```

`slate_reading` shows:

- how many headings were read off the page
- how many scenes the model returned
- how many scenes were rebuilt from the page
- whether every section agreed
- why story day did nothing (`story_days_skipped`)

Scenes can't go missing once their headings are found. On all five test
screenplays, every heading came through: IRIRI 65/65, LORI NKAN MI 47/47,
WHEN LOVE FINDS YOU 18/18, THE HILLS BETWEEN US 86/86, iRANTI 115/115. What
isn't guaranteed is that the page reader finds every heading in the first
place.

---

## What Slate can't do yet

These are known gaps, and a professional will notice each one. Tell
filmmakers before they rely on Slate for them.

### 1. Story day is empty

The story-day pass runs but returns nothing on live scripts, so there's no
continuity report and a script supervisor gets nothing from Slate. This is
the biggest gap. To see why on a given run, check
`slate_reading → story_days_skipped`: it shows `http_401`, `threw`, or the
name of the gate that stopped it.

### 2. Production Details are blank until someone fills them in

Director, producer, 1st AD, nearest hospital and base camp come from
Production Details, not from the script. A call sheet with dashes under Key
Contacts can't be handed out. This is data entry, not code: fill the details
in for each production before generating call sheets.

### 3. Company moves don't split a day

The packer fills each day by page count and scene count only, so it can put
four locations into one day. Slate prints an advisory when this happens, but
a 1st AD would have split that day. Read the advisories and move scenes by
hand.

### 4. No call sheet revision tracking

Professional call sheets are versioned and colour-coded (white, blue, pink…).
Slate only gives each one a run ID. If two versions of the same day go out,
nobody can tell which one is current. Until this is built, send one version
per day, and if you have to reissue, write the revision on it and tell the
crew to bin the old one.

### Also worth knowing

- **Call times are derived from scene order, not negotiated.** Treat them as
  a sensible first draft, not a final call sheet.
- **Scene numbers come only from the script.** A scene the writer didn't
  number prints as `—`. That's deliberate: an invented number would end up
  on a clapperboard as if the writer chose it.
- **A montage's props, vehicles and cast are listed on every day it
  shoots,** because the script doesn't say which part needs them. Confirm
  before booking.

---

## Rules that keep this safe

- All commits go to `v2-build`. `production` is protected. **Never
  force-push.**
- The repo is public, so never put a key in any committed file.
- Never ask a filmmaker for their screenplay (`copy-probe` enforces this).
- No production database change without Elizabeth's written approval.
- Batch your commits, because each push costs a build credit.
- Test on the published deploy, not on a preview.
- Only one person or session on `v2-build` at a time.
