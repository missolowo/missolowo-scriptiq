# Tests

```
node tests/run.js            # every probe, ~2 seconds, no dependencies
node tests/page-load.js      # loads each page in a real browser (needs playwright)
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

**A failing test is not necessarily a bug.** One assertion here was wrong
rather than the code: it claimed an actor worked only day 2 while a scene of
his sat on day 1. Read what the test asserts before changing what it tests.
