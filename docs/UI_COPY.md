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
