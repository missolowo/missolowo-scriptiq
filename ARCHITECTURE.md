# Missolowo Slate — Architecture Note

**Scene identity and the production pipeline**

Version 1.0 · September 2026 · Approved by Product

---

## Why this document exists

Between July and September 2026 the same bug was fixed five separate times. A scene arriving without a number produced a wrong label in one report, then a wrong total in another, then a wrong row in a third, then — most seriously — a call sheet listing scenes from the wrong part of the film. Each fix was correct in its own place and none of them fixed the cause.

The cause was a single architectural mistake: **the scene number was being used as the scene's identity.** It is not, and it cannot be.

This note records how scenes actually flow through the system, so that future work builds on the corrected model rather than rediscovering the same problem.

---

## The two identifiers

Every scene carries two values. Confusing them is the failure this architecture exists to prevent.

### `scene_index` — identity

An integer assigned by `mergeBreakdownChunks` in `app.html`: the scene's position in the assembled script, starting at 1.

- Assigned once, in one place, immediately after the AI's sections are combined
- Never changes for the life of the production
- Always present — it is generated, not extracted
- Never shown to a user

**Everything that needs to answer "which scene is this?" uses `scene_index`.**

### `scene_number` — display

The number printed in the screenplay, copied exactly as written, as a string.

- Comes from the writer, not from us
- May be absent, because a montage or insert often has none
- May repeat, because two scenes can both be numbered 47
- Is not numeric: `47A`, `2.01` and `00` are all valid and none survives `Number()`
- Is what the crew reads on their pages, so it must be reproduced faithfully

**Nothing internal may match, sort, count or group by `scene_number`.**

---

## Why `scene_number` cannot be identity

Four properties, each fatal on its own:

1. **It can be missing.** A script may leave scenes unnumbered. If identity is the number, every unnumbered scene shares the same identity — `null`.
2. **It can repeat.** Two different scenes numbered 47 are two scenes, not one.
3. **It is not a number.** `47A` sorts after `47` and before `48`, which no numeric comparison gets right. `2.10` is not `2.1`.
4. **It belongs to the writer.** They may renumber between drafts. Our identity must not change when they do.

### What this actually caused

The call sheet selected the day's scenes like this:

```js
const todaysSceneNumbers = new Set(dayData.scenes.map(s => s.scene_number));
breakdown.scenes.filter(s => todaysSceneNumbers.has(s.scene_number))
```

If any of today's scenes had no number, the set contained `null`, and the filter matched **every unnumbered scene in the script**. On a real screenplay with ten unnumbered scenes, a Day 3 call sheet listed scenes shot three weeks later, with their cast called to set.

That is not a display bug. That is a crew arriving at the wrong location.

---

## How a scene flows through the system

### 1. Upload — the browser, `app.html`

Text is extracted from PDF, DOCX or TXT. Nothing has been sent anywhere yet.

### 2. Script Health Check — the browser

Runs before any credit is spent. Advisory only: it reports duplicate numbers, unreadable headings, unnumbered scenes, and possible name variants. It never blocks, and it never changes the script.

### 3. Splitting — the browser

`splitScriptForProcessing` discards front matter, captures the title, and cuts the script into sections at scene headings only, never mid-scene.

Two rules matter here:

- **Heading patterns are defined once**, in `SLATE_HEAD` and `SLATE_NUM`, and every heading test builds on them. Adding a language is one edit.
- **A lone scene-number line is rejoined to the scene below it.** Scripts that write `SCENE 5` on its own line, with the heading on the next, would otherwise have the number end one section while its scene starts the next — and the AI, correctly, returns `null` for a heading with no number.

### 4. Extraction — the server, `breakdown.js`

One section per call. The AI extracts scenes, cast, background, props, costume and equipment. It copies scene numbers exactly and returns `null` where a heading carries none.

The AI is asked for facts it can read. It is never asked to count, sort or group — that is arithmetic, and code does it reliably.

### 5. Merge — the browser, `mergeBreakdownChunks`

**This is the only point at which the complete breakdown exists.** The server sees one section at a time and never the whole.

Here, in order:

1. Sections are combined and **`scene_index` is assigned**
2. Scene numbers are normalised — the AI sometimes returns the string `"null"` rather than a real null
3. Character and location indexes are rebuilt from the assembled scenes, not merged from per-section counts
4. One canonical spelling is chosen per character and per location, and applied back to every scene

**The merge always runs, even for a single section.** It previously did not, which meant short scripts silently ran different code from long ones — so test scripts behaved differently from real ones.

### 6. Schedule — the server, `schedule.js`

Built deterministically in code: scenes grouped by location, day and night kept apart, distributed across the requested days. The AI is used only for production notes, and fails safe if unavailable.

`scene_index` is carried through as `idx` and emitted on every scheduled scene.

### 7. Call sheet — the server, `callsheet.js`

Selects the day's scenes **by `scene_index`**. Facts come from data; the AI supplies only judgement — call times and notes. It is never asked for a title, an address or a scene list, because it does not know them and would invent them.

### 8. Export — the browser

All three documents share one engine, `slateDoc`. Non-Latin and accented scripts load a Unicode font on demand, including Latin Extended for Yorùbá, Igbo and Hausa.

---

## Standing rules

**One implementation per concept.** Scene parsing, character normalisation, sorting, title extraction and location normalisation each have one definition. Where the runtime boundary prevents genuine sharing — the browser and Netlify Functions cannot import from each other without a build step — mirrored copies are marked as such, and a change to one requires the same change to the other in the same commit.

**Derive, don't ask.** Anything that can be computed from data is computed. Counting, sorting, grouping and totalling are arithmetic. The AI is for reading a screenplay, not for doing sums.

**The filmmaker decides.** Where software cannot know the answer — is Tinuke the same person as Atinuke, how many background actors a scene needs — it asks, and never decides silently.

**An empty field is an answer.** Where a script genuinely specifies nothing, the document says so rather than inventing filler or leaving a gap that reads as a fault.

---

## For future modules

Budget, Crew Management and anything else built on this data:

- Join to scenes on `scene_index`
- Display `scene_number`
- Read the breakdown as assembled by the merge, never a single section
- Add languages by extending `SLATE_HEAD` and `SLATE_NUM`, not by writing a new pattern

**Build it once.**
