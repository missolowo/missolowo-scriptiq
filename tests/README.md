# Tests

```
node tests/run.js             # every probe, ~2 seconds, no dependencies
node tests/page-load.js       # loads each page in a real browser (needs playwright)
node tests/resume-browser.js  # the resume offer, rendered at phone width (needs playwright)
```

`run.js` exits non-zero if anything fails.

## What these are, and why they look unusual

They read the real source out of `app.html` and `netlify/functions/schedule.js`
and run it. They do not contain a copy of the logic they test.

That is deliberate. A test holding its own copy of the code passes happily
while the shipped version drifts away from it — and the first you hear is a
filmmaker on set with a document that is wrong. These extract the function
by name, brace-match to its end, and execute that text against stubs. Rename
a function or change its shape and the test fails loudly, which is the point.

Most of the product is one large `app.html` and a handful of Netlify
functions. There is no build step and no module system in the browser code,
so this is how it gets tested without restructuring the application first.

## Running the function tests

`derive-probe`, `assign-probe` and `compromise-probe` `require()`
`netlify/functions/schedule.js` directly. That needs the Supabase client:

```
npm install --no-save @supabase/supabase-js
```

The others read source text and need nothing.

## What each one covers

| Probe | What would break without it |
|---|---|
| `retry-probe` | A dropped connection destroys a whole breakdown. Three filmmakers lost their first run this way on launch day. |
| `isolation-probe` | A call sheet carries the previous production's hospital and emergency contacts. |
| `derive-probe` | A day header names the wrong place, or an actor is released the day before he is called. |
| `assign-probe` | A scene vanishes from the schedule and surfaces on a morning nobody planned to shoot it. |
| `move-probe` | A filmmaker's edit is sent wrong, or a stale call sheet is exported as a PDF. |
| `compromise-probe` | An advisory quietly reorders a crew's day instead of suggesting. |
| `pricing-probe` | The page advertises a price the checkout does not charge. |
| `resume-probe` | An interrupted breakdown is lost, charged twice, or resumed into the wrong screenplay. |
| `copy-probe` | We ask a filmmaker to send us their screenplay, or promise something the product does not do. |
| `prompt-probe` | We pay the model for a list we already derive from the scenes. |
| `merge-probe` | A shopping list is missing items, or the cast list and Report 2 name different people. |
| `numbering-probe` | `#11` and `11` appear in one report with nothing to say they are different scenes. |
| `cast-probe` | Two performers are merged into one call-sheet row, or a voice credit is billed as a second actor. |
| `korean-probe` | The panel tells a Korean filmmaker we cannot read their screenplay while the splitter reads it fine. |
| `funnel-probe` | The steps before a breakdown go silent again, or an event carries somebody's email address. |

## Things worth knowing before you change them

**The cast release schedule is the dangerous output.** It tells a producer
when to stop paying an actor. Several assertions exist only to prove it is
recomputed whenever scene-to-day assignment changes.

**Credits are charged on the last chunk, after it succeeds.** This is why
nobody was charged for the failures on launch day. If you move that, expect
`retry-probe` to object.

**`node --check` is not enough.** It has twice passed a file that threw as
soon as it ran — once a function referencing a variable that existed only
inside another function, once a value used before it was declared. Both were
caught by running the code. Run the probes.

**A window measured in characters fails whenever something above it grows.**
`resume-probe` sliced 1400 characters after the Generate handler and broke
three times on 16 November because three analytics calls were added inside
that handler — the code correct every time. `numbering-probe` had the same
failure on Report 2. Bound a slice by the next landmark, not by a count.

**A scroll-depth threshold expressed as a percentage of a section is a
trap.** A section taller than the screen can never be 40% visible, and on a
phone most of them are. The homepage rule is "the section's top rises into
the upper two thirds", plus a separate rule for the last section: the
closing section is 144px tall, so on an 844px phone its top sits at 646px
even scrolled fully to the bottom, below any such line. Without that second
rule the one event meaning *this person read the whole page and still did
not sign up* was the one event that could never fire.

**An analytics call is the easiest thing here to delete by accident.**
Nothing breaks, nothing fails, and no filmmaker complains — the funnel just
goes quiet and nobody notices for a month. That is not hypothetical:
app.html carried eighteen `siqTrack` calls and no GA4 tag, so `typeof gtag`
was never `'function'` and every one was dropped by its own guard.
`funnel-probe` asserts the calls exist; `funnel-browser.js` proves they
arrive.

**Before any change to scene-heading detection, run it against real
screenplays.** `node tests/ab-real-scripts.js production script.txt ...`
prints every field that changed between the deployed code and the working
copy. On 16 November a change passed all 442 assertions and still read LORI
NKAN MI as 53 scenes instead of 47, dropping it from green to amber, because
every fixture in the suite put the scene number on the heading line and
Nollywood scripts put it on a line of its own. No assertion was wrong. The
suite had never seen the shape. Fixtures cover what someone thought of;
real scripts cover what nobody did.

**Scene-heading detection is a PAIR, and the pair is the bug.** The health
panel and the splitter read headings through different regexes. Twice now
one has been taught a new format and the other has not — Turkish, then
Korean and Japanese — and the result each time was the worst shape of
wrong: the breakdown ran correctly while the panel told the filmmaker we
could not read their screenplay. `korean-probe` asserts the two agree on
every fixture. Improve either half and run it.

**A failing test is not necessarily a bug.** One assertion here was wrong
rather than the code: it claimed an actor worked only day 2 while a scene of
his sat on day 1. Read what the test asserts before changing what it tests.
