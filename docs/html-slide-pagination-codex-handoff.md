# Handoff To Codex — What Happened To S0–S3

You built S0–S3 (metrics, `extractContentUnits`, the plan validator, the heuristic planner)
and wrote `html-slide-pagination-handoff.md` with a five-step next milestone. All five steps
are done, plus everything they uncovered. That is 13 commits, `b23694f..8ca8bf8`, pushed to
`origin/main`.

This file is the orientation. `html-slide-pagination-handoff.md` has the full chronological
record as S4–S17 if you want the reasoning behind any single change.

## The Short Version

**Your architecture held. Every function you wrote still exists and is still called.** What
changed is what feeds them, what they measure with, and where they are wired.

The one thing that had to be thrown away is the cost model inside
`estimateHtmlContentCost()`. Everything else was extended, not replaced.

## The Bug That Made S1–S3 Inert

Worth knowing first, because it explains why so much changed.

`extractContentUnits(sourceRoot)` was called with `#reader-main-content`. But every display
path — `refreshContent()`, `hideLoadingState()`, `applyFormattedContent()` — does
`contentContainer.appendChild(this.selectedContent)`, so that element **always has exactly
one child**, `div.reader-restructured-content`. Unit extraction returned 1 unit and the
planner returned 1 slide, on every no-TOC page. Measured across 7 fixtures before the fix:
`unitCount: 1, slideCount: 1`, slide costs 1201–3772.

`resolveHtmlSlideContentRoot()` now descends through single-child wrappers to the real
content root. It refuses to descend into a list, table wrapper, media or attachment card,
so units never become `li` or `tr`.

## What The Pipeline Looks Like Now

```text
buildHtmlSlidesFromCurrentContent()
  └─ createHtmlSlidePlanningRoot(sourceRoot)
       resolve the real content root → clone it (the live DOM is never touched)
       → splitTableAtSectionRows()      ESA section rows hoisted to top-level <h2>
       → splitOversizedContentGroup()   over-budget lists/paragraph groups
       → splitOversizedTableUnit()      over-budget tables, row-span-safe cuts
       → splitOversizedTextBlock()      over-budget <br> paragraphs
  └─ extractContentUnits(contentRoot)        ← yours, unchanged
  └─ base plan
       TOC page → cached AI plan (boundaries restored) or createTocHtmlSlidePlan()
       no TOC   → cached AI plan or createHeuristicHtmlSlidePlan()   ← yours
  └─ validateAndRepairHtmlSlidePlan()        ← yours
  └─ rebalanceHtmlSlideTails()
  └─ mergeUnderBudgetHtmlSlides()
  └─ renderHtmlSlidesFromPlan(plan, contentRoot)
```

Normalisation runs on a **detached clone**. That is what made splitting legal at all — the
reader's own DOM is never modified, which a test pins.

## The Cost Model Was Wrong, And Here Is How We Know

Yours charged by character count. Rendered height is driven by **line count**, so it ignored
wrap waste and per-block margins. Measured in Chrome, a slide costed at 850 needed **2.74×**
the visible height.

`estimateHtmlContentCost()` is now a recursive layout walk where one cost unit is a fixed
slice of vertical pixels. Everything below was measured against the rendered lightbox, not
guessed:

| what | how it is costed |
|---|---|
| text block | `ceil(charUnits / charsPerLine) × lineCost + blockCost` |
| `<br>` | each segment costs at least one line — ESA writes checklists as one paragraph |
| headings | scaled: slide headings render at 34px/30px, metadata at 20px, body at 28px |
| character width | full-width punctuation（，。：、）counts 1, latin 0.5 — not 0.5 and 0.33 |
| list item | same as text, smaller margin |
| table row | tallest cell's lines + cell padding; cells count their own `<br>` and images |
| media | real aspect ratio, clamped by `.reader-image { max-height: 70vh }` |
| attachment card | `min-height: 92px` grid, by card count and column width |

`getHtmlSlideLayoutMetrics()` derives all of it from the **current viewport**, including the
`max-width: 760px` breakpoint. `getHtmlSlidePlanBudget()` is the single source of
`targetCost / maxCost / minCost / maxSlides` — your `650 / 900 / 160` constants are gone.

Accuracy now, across all 234 slides of a long Wikipedia article: predicted/rendered height
median **1.02**, p10 0.93, p90 1.17.

## Two Rules That Are Load-Bearing

**Never eat a navigation label.** Plan slides carry `generatedTitle: true` when the system
invented the title (會議資訊, （續 N）, 簡報內容). Only those can be absorbed by
`mergeUnderBudgetHtmlSlides()`. An AI plan carries no such marker, so every title a model
chooses counts as real. If you add another merge or compaction pass, honour this.

**Boundaries are adjacent-only, still.** Split, merge and restore all operate on adjacent
slides. `isStructurallyValidHtmlSlidePlan()` — yours — is the gate, and the AI plan goes
through it like anything else.

## The TOC Path Moved (Your Doc Said Not To)

Your note said not to replace it until equivalence was tested. It was tested, then replaced.

The blocker turned out to be real and worth recording: ESA section titles live **inside a
table**, at depth 4, because `processHeaders()` finds `.reader-header` at any depth and
`processTable()` marks single-cell section rows. A plan addressed by
`contentRoot.children` indexes could not express those boundaries — forcing it produced
slides where 學務處's items rendered under a 教務處 header.

`splitTableAtSectionRows()` hoists those rows to real top-level `<h2>` first. Then
`createTocHtmlSlidePlan()` maps every TOC entry to a top-level heading, **in order**, and
returns `null` the moment one does not match — in which case `buildHtmlSlidesFromTocRanges()`
(your original code, moved verbatim) renders the page instead. Tables with a `rowSpan`
crossing a section boundary take that route automatically, and a fixture pins both branches.

Payoff, measured on a real meeting: the range path gave 21 slides of which **8 were over
budget**, worst cost 3828 against 1080. The plan path gives 0 over budget and nothing
scrolls.

## The AI Slide Plan Exists Now

Approved explicitly. Design in `html-slide-ai-plan-design.md`.

It is a **separate Gemini call** at the end of `startAIProcessing()` — folding it into the
existing prompt would have changed `aiCachePromptVersion`, which is still forbidden. It
returns boundaries only, is validated by your chain, and lives in its own
`webReaderSlidePlanCache` store. **Opening the lightbox never calls AI**, only reads that
cache.

Three things the live runs taught, all of which cost time:

1. A **small** output cap is the wrong lever. At 2000 tokens the reply was a 156-character
   fragment of the model's reasoning. Raising it to 32000 did not help either.
2. The lever is thinking. Same trivial prompt: plain spent 191 thought tokens and returned
   prose; `responseMimeType: application/json` returned valid JSON after 386; adding
   `thinkingBudget: 0` returned the 45-character answer with no thinking at all.
   `background.js` now accepts both, allow-listed and additive.
3. Do not ask the model to do arithmetic. Told to keep each slide under `maxCost`, it spent
   its whole budget summing costs.

On a real meeting the model hit 16 of 17 required boundaries. Rejecting the whole plan for
that was too strict, so `restoreRequiredHtmlSlideStarts()` splits at the missing one instead.
Result: `toc-ai-plan-restored-repaired-rebalanced`, 40 slides, overflow 1.00, and the side
navigation reads 教學組 評量與本土語 / 競賽與公佈欄 / 行政與教學宣導 instead of
二、教學組（續 1…4）.

## How To Verify Anything You Change

`docs/html-slide-pagination-fixtures.html` — 14 fixtures through the real pipeline in a real
browser. Serve the repo root over HTTP; `file://` cannot resolve `../content.js`. Results land
on `window.__htmlSlideFixtureResults`, each row has a 開啟燈箱 button, and
`window.__measureFixtureOverflow(name)` returns the measured overflow per slide.

The four numbers that matter, in this order:

1. `possibleTextMismatch` — false everywhere today. A `true` is a real regression.
2. unit coverage — concatenate each slide's title + body and confirm every unit's text
   appears, in order. 0 missing, 0 out of order on both real meetings and both formatters.
3. measured overflow — `scrollHeight / clientHeight` per slide, not the cost estimate.
4. `overlongSlideCount` — expected to be non-zero only for a single atomic unit bigger than
   a screen.

`npm run test:html-slides` runs 90 tests over two `.cjs` files plus
`tests/helpers/fake-dom.cjs` (a mutable fake DOM with text nodes, `childNodes`, `rows` and
`cells`). The old `tests/*.test.js` are still untouched, as you asked.

## Gotchas That Will Cost You An Hour Each

- **Content scripts run in an isolated world.** `window.webReader` is invisible from the
  page's main world. Probe the execution context named `網頁簡報器` — and probe each
  candidate, because a tab keeps stale isolated contexts from previous documents alongside
  the live one.
- **Reload the extension before the tab, never after.** The other order invalidates the
  content script and you pay for another round trip. `chrome://extensions` itself sometimes
  needs reloading before its dev-reload button responds.
- **The ESA SPA cannot restore a meeting from its deep link** after a full page load. Get
  there through 會議管理 → the meeting's name link. The year filter is a checkbox *in front
  of* the select — tick it, then press 查詢.
- **To test pagination changes without losing page state**, inject the current `content.js`
  over CDP as `(function(module, chrome){…})(shim, undefined)`. Shadowing `chrome` skips the
  extension bootstrap. It runs in the main world, so it cannot make API calls — for those you
  need a real extension reload.
- **One CDP probe at a time.** Two overlapping probes on the same tab wedge the renderer.

## What Is Actually Open

1. Nested tables stay atomic — their structure is not knowable from outside.
2. A single block taller than a screen cannot be paginated. On that Wikipedia article, 18 of
   29 scrolling slides were exactly that, worst 5397px. Fixing it means unwrapping layout
   tables in the offline formatter — reader-side, not planner-side. Meeting content does not
   hit this.
3. `htmlSlidePlanEnabled` exists but nothing toggles it, so every AI run pays for one extra
   request.
4. The 0.95 safety factor in `getHtmlSlidePlanBudget()` is a judgement call, not a
   measurement.
5. The plan request hardcodes `gemini-3.5-flash`; the extension's OpenAI path has no
   equivalent.
6. A cached AI plan is gated by `getHtmlSlidePlanUnitSignature()`, and the unit list is
   viewport dependent — so a plan helps at the window size it was made for, and the heuristic
   runs at others.

## Still Binding

- `aiCachePromptVersion` untouched; `webReaderAICache` entry shape unchanged.
- No rendered slide HTML in any cache.
- No non-adjacent reorder.
- Old test system untouched.

All four verified as held at `8ca8bf8`.
