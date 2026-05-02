# UI copy style guide — pdfcraftai.com

A short, opinionated guide for the words on buttons, errors, prompts, and helper
text. Goal: every surface reads in the same voice, so the product feels like one
thing rather than 100 tools bolted together.

This doc is short on purpose. If a rule isn't here, default to "say what
you mean, in five words or fewer."

---

## Voice in three lines

- **Direct.** No "please," no "kindly," no "we're sorry but…"
- **Imperative on action surfaces.** Buttons, prompts, and CTAs start with a verb.
- **Specific over polite.** Tell the user exactly what's wrong and the next move.

---

## Buttons (CTAs)

**Imperative verb + object.** No "please," no terminal punctuation.

| Good | Bad |
|---|---|
| `Add watermark` | `Please add watermark.` |
| `Rotate 90°` | `Click to rotate.` |
| `Sign in to parse` | `Continue` |
| `Watermark another PDF` | `Try another?` |
| `Apply 3 highlights` | `Save Changes` |

**While busy:** keep the verb in present-continuous, no "please wait."
- `Stamping…` not `Please wait, stamping…`
- `Adding watermark…` not `Working on it…`

**Disabled-state hint:** when a button can't fire, its label should explain why,
not stay frozen on the active label. Example: `Drop a PDF first` (instead of a
greyed-out `Apply watermark`). The disabled label restores to the active label
as soon as preconditions are met.

**Past-tense success CTAs after the result lands** (the "do it again?" CTA at
the bottom of the result card):
- `Watermark another PDF`
- `Number another PDF`
- `Sign another PDF`

---

## Errors — three rules

1. **No apology.** Skip "Sorry," "We're sorry," "Apologies." The user already
   knows something went wrong; the apology adds nothing.
2. **Lead with the problem, end with the action.** "That's not a PDF. Try a
   .pdf file." (problem → action) rather than "Please try a different file
   format." (action with no diagnosis).
3. **Five-to-twelve words.** If you need more, you're probably explaining
   something the UI should already make obvious.

### Canonical errors (use these phrasings)

| Trigger | Canonical message |
|---|---|
| User dropped a non-PDF | `That's not a PDF. Drop a .pdf file to continue.` |
| File exceeds size limit | `File over 100 MB — try a smaller one.` |
| No file attached when applying | `Drop a PDF first.` |
| Required field empty | `[Field name] is required.` |
| PDF has no pages | `This PDF has no pages.` |
| Network/server failure (generic) | `Something went wrong — try again.` |

### Anti-patterns

| Bad | Good |
|---|---|
| `Please drop a PDF file.` | `That's not a PDF. Drop a .pdf file to continue.` |
| `Attach a PDF first.` | `Drop a PDF first.` |
| `Attach a PDF to rewrite.` | `Drop a PDF first.` (or context-specific equivalent) |
| `An error occurred.` | `Something went wrong — try again.` |
| `Invalid input.` | `[Specific field] needs [specific format].` |

### AI-specific error shapes

AI tools have three failure modes worth distinguishing because each
demands a different recovery hint. Documented 2026-05-02 after audit
across 14 AI tools confirmed all already follow these shapes — this
section pins them as canonical for future tools.

**1. Document-shape mismatch** (user uploaded the wrong KIND of PDF —
e.g. a marketing flyer to the Blood Test Analyzer). Diagnostic tip
should mention what the tool expects:

| Good | Bad |
|---|---|
| `Couldn't parse this as a lab report. Ensure the PDF has named tests with values.` | `Couldn't parse.` |
| `This doesn't look like a court judgment — try a different file.` | `Parse failed.` |
| `No resume content found. Try a PDF with a contact section + work history.` | `Could not extract resume.` |

**2. Transient AI response failure** (model returned malformed JSON
or no useful content — usually clears on retry):

| Good | Bad |
|---|---|
| `Couldn't parse the AI's response. Usually resolves on retry.` | `Server error.` |
| `Something went wrong — try again.` | `Internal error.` |

**3. Empty / no-result response** (AI didn't find what the user asked
for — diagnose with a workaround rather than making the user guess):

| Good | Bad |
|---|---|
| `No valid flashcards returned. Try a text-heavier PDF.` | `No flashcards.` |
| `No tables found in this PDF.` | `Empty result.` |
| `No matching dates in the PDF text.` | `0 results.` |

**Rule of thumb for shape (1)**: lead with the problem in domain
language, end with a specific action ("Ensure the PDF has X").

**Rule of thumb for shape (2)**: route generic AI failures through
`mapPdfOpError(...)` from `lib/pdf/error-messages` — that helper
maps technical exception messages to user-facing copy following
this guide. 14 of 14 AI tools audited route through it.

**Rule of thumb for shape (3)**: name what wasn't found and the
likely workaround. Don't make the user guess whether the PDF was
unreadable or simply lacks the requested content.

---

## Dropzone prompts

**Pattern:** `Drop a PDF to <verb the result>`

- `Drop a PDF to watermark`
- `Drop a PDF to count pages`
- `Drop a PDF to fill & sign`

**Variations** — when the action is itself a noun, drop the "to":
- `Drop a PDF to inspect its fonts` (verb)
- `Drop a PDF to analyse its voice and writing style` (verb)

**Hint line under the prompt** — capacity + privacy in one phrase:
- `Up to 100 MB · runs privately in your browser`

---

## Helper text and counts

**Singular/plural always handled inline.** Never `1 page(s)`. Use
`page${n === 1 ? "" : "s"}` or its equivalent. The conditional adds zero
overhead and reads correctly in every case.

| Good | Bad |
|---|---|
| `Numbered 12 of 12 pages` | `Numbered 12/12 page(s)` |
| `1 stroke · 8 points` | `1 stroke(s) · 8 point(s)` |
| `3 highlights` | `3 highlight(s)` |

**Page-aware counts** — when state is per-page in a multi-page editor,
mention the page:
- `2 strokes · 47 points on page 4`
- `Apply 7 highlights on 4 pages`

---

## Loading / busy states

**Present-continuous verb + ellipsis.** No "please wait."

| Good | Bad |
|---|---|
| `Stamping…` | `Please wait, stamping the PDF…` |
| `Rendering preview…` | `Loading…` |
| `Saving drawing…` | `Working…` |

**Spelling: prefer British/Indian (-ising / -ysing)** for verbs that
have both forms. The site is India-based — INR pricing, India-
specific landing copy throughout. Use `Analysing…` not `Analyzing…`,
`Recognising…` not `Recognizing…`. Verbs that take only -ize in both
dialects (`Summarize`, `Memorize`, `Customize` per Oxford spelling)
keep the z. The audit table:

| British/Indian (use this) | American (avoid) |
|---|---|
| `Analysing…` | `Analyzing…` |
| `Recognising…` | `Recognizing…` |
| `Categorising…` | `Categorizing…` |
| (these stay -ize) | `Summarizing…` ✓, `Optimizing…` ✓ |

**Generic `Working…` / `Loading…` are fallbacks.** If you find
yourself writing one, ask whether you can name the actual operation.
Acceptable as a TRANSITIONAL initial state when the real label
arrives within a few hundred ms (e.g. SearchablePdfTool starts at
`Working…` then setBusyLabel transitions to "OCR pass —
transcribing pages…" once the AI route hands back its phase
estimate). NOT acceptable as a steady-state busy label.

---

## Success messages

**Headline says what happened, detail says how big.**

```
Watermarked 12 pages              ← headline
Output: 1.4 MB · 50% size · 30% opacity   ← detail (subtle, secondary)
```

If a single page was edited, name the page:
```
Drew 4 strokes on page 3
4 line segments · 218 KB
```

---

## Things to avoid (tone)

- **Exclamation marks.** Almost never. The product isn't excited.
- **Cute/breezy filler.** No `Awesome!`, `Boom!`, `Voilà!`. Save the energy
  for the docs page if you must.
- **Second-guessing.** No `Did you mean to…?`. Either we know, or we don't
  ask.
- **Apologies for things that aren't our fault.** A user dropping an MP3 into
  the PDF tool isn't an occasion for `We're sorry.`.

---

## Compliance with this guide

This guide isn't enforced by tests. It's enforced by review: when a new tool
ships, scan its setError() calls and button labels against this doc. If
something feels off, fix it before merge. The test harness (`npm test`) will
keep behavior intact while you adjust strings.

When in doubt: **say what you mean, in five words or fewer.**
