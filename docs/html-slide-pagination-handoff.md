# PagePresenter HTML Slide Pagination Handoff

This handoff is for continuing the PagePresenter "轉成 HTML 簡報" pagination-quality work.

## Current Workspace State

- Branch: `main`
- Upstream: `origin/main`
- Current work is uncommitted.
- Modified tracked files:
  - `content.js`
  - `package.json`
- New untracked files:
  - `tests/html-slide-content-units.test.cjs`
  - `docs/html-slide-pagination-discussion.html`
  - `docs/html-slide-generic-content-units.html`
  - `docs/html-slide-pagination-handoff.md`

## Product Decisions

- Do not call AI when opening the HTML slides lightbox.
- The feature wording is "轉成 HTML 簡報" or "生成/轉成", not "匯出".
- The default experience is in-page lightbox, not download-first.
- No preview flow. If the result is unsatisfactory, the user reruns processing later.
- V1 must not allow non-adjacent reorder. Only adjacent merge and overlong split are allowed.
- AI should eventually output only slide boundaries, not HTML.
- For now, this work intentionally does not add any AI call.

## Architecture Decisions

- Content units must be extracted from the rendered reader DOM, not the original page DOM.
- Use one extractor:
  - `extractContentUnits(contentDom, siteProfile)`
- Do not create separate ESA and generic extractors.
- ESA-specific knowledge should eventually become a `siteProfile` that answers:
  - which nodes are headings
  - which nodes are metadata
  - which nodes are atomic and should not be split
- Unit indexes must stay aligned with `contentDom.children`.
- The renderer must always cut content from the same `contentDom` by index.
- AI or heuristic plans may only affect page boundaries.

## Implemented So Far

### S0: Pagination Metrics

Implemented in `content.js`.

Key functions:

- `finalizeHtmlSlides(slides, sourceRoot, strategy, diagnostics)`
- `calculateHtmlSlideQualityMetrics(slides, sourceRoot, strategy, diagnostics)`
- `recordHtmlSlideQualityMetrics(metrics)`
- `createHtmlSlideUnitDiagnostics(units)`
- `createHtmlSlidePlanDiagnostics(plan)`

Metrics currently include:

- slide count
- source text length
- total slide text length
- duplicate-heading compensation
- possible text mismatch flag
- slide cost distribution
- unit count and unit cost distribution
- unit kind/flag counts
- plan target/max cost and max slide count

### S1: Content Unit Extraction

Implemented in `content.js`.

Key functions:

- `extractContentUnits(contentDom, siteProfile)`
- `createContentUnitFromElement(element, index, siteProfile)`
- `getContentUnitFlags(element, siteProfile)`
- `getContentUnitHeadingLevel(element, siteProfile)`
- `getContentUnitTitle(element, kind)`
- `estimateHtmlContentCost(element)`
- `createContentUnitPreview(text)`

Current unit schema:

```js
{
  index,
  kind: 'heading' | 'block' | 'atomic',
  level,
  title,
  preview,
  cost,
  breakable,
  flags
}
```

Current flags:

- `list`
- `table`
- `media`
- `metadata`
- `department`

### S2: Plan Validation and Repair

Implemented in `content.js`.

Key functions:

- `validateAndRepairHtmlSlidePlan(rawPlan, units, fallbackPlan, options)`
- `isStructurallyValidHtmlSlidePlan(plan, units)`
- `compactHtmlSlidePlanToMaxSlides(slides, units, maxSlides)`
- `getHtmlSlideUnitsCost(units)`
- `getHtmlSlideUnitsInRange(units, start, end)`

Validator currently checks:

- plan has slides
- slide indexes are integers
- start/end are valid
- no gaps
- no overlap
- no reordering
- unit indexes are contiguous before rendering
- overlong multi-unit slides are repaired by heuristic splitting
- too many slides are compacted by adjacent merge only

### S3: Heuristic Planner

Implemented in `content.js`.

Key function:

- `createHeuristicHtmlSlidePlan(units, options)`

Behavior:

- Splits before headings when current accumulated cost is large enough.
- Splits when accumulated cost would exceed max cost.
- Keeps atomic units intact.
- Compacts adjacent slides if `maxSlides` is exceeded.
- Does not reorder.

Current defaults:

- `targetCost`: `650`
- `maxCost`: `900`
- `minCost`: `160`
- `maxSlides`: `24`

## Current Runtime Behavior

In `buildHtmlSlidesFromCurrentContent()`:

- If TOC entries exist, current TOC fallback behavior is preserved.
- If no TOC entries exist, the no-TOC path now uses:

```text
extractContentUnits(sourceRoot)
→ createHeuristicHtmlSlidePlan(units)
→ validateAndRepairHtmlSlidePlan(...)
→ renderHtmlSlidesFromPlan(plan, sourceRoot)
```

This is intentionally conservative:

- ESA / meeting pages with TOC should remain behaviorally stable.
- Generic pages without reliable TOC can start benefiting from heuristic pagination.

## Tests

New test file:

- `tests/html-slide-content-units.test.cjs`

New npm script:

```bash
npm run test:html-slides
```

Verified commands:

```bash
npm run test:html-slides
npm run check
```

Latest result:

- `npm run test:html-slides`: 12 tests passed
- `npm run check`: passed

Note:

- Existing older `tests/*.test.js` are CommonJS-style files in a `"type": "module"` package, so they do not run directly with `node --test tests/*.test.js`.
- Do not fix the whole test system unless explicitly scoped. The new test uses `.cjs` to avoid broad churn.

## Important Risks

- `renderHtmlSlidesFromPlan()` assumes `unit.index === contentDom.children[index]`.
- Do not filter units after extraction unless preserving index alignment.
- `possibleTextMismatch` is currently observational only; it does not block rendering.
- `matchedSlideTitleTextLength` compensates for headings removed by `removeDuplicateHtmlSlideHeading()`, but it is still a heuristic.
- The no-TOC heuristic path should be visually checked on real pages.
- The TOC path has not yet been converted to plan rendering; this was intentional to reduce behavior risk.

## Suggested Next Work

Recommended next milestone:

1. Add browser/manual verification fixtures for no-TOC generic pages.
2. Create or reuse static HTML samples:
   - long article with no headings
   - one `h1` only
   - all `div` content
   - table-only page
   - list-heavy page
3. Use the actual extension UI or a browser fixture to confirm:
   - no-TOC pages now split into multiple useful slides
   - side navigation still works
   - lightbox rendering area remains stable
   - metrics show reasonable unit/slide cost distribution
4. If visual behavior is acceptable, consider converting the TOC path into an equivalent plan-rendering path as a separate safe refactor.
5. Only after S0-S3 are visually verified, decide whether AI slide-plan calls are worth adding.

## Do Not Do Yet

- Do not add AI slide-plan calls yet.
- Do not bump `aiCachePromptVersion`.
- Do not store rendered slide HTML in cache.
- Do not allow non-adjacent reorder.
- Do not replace the existing TOC path until equivalence is tested.
- Do not rewrite the old test system unless asked.

## Useful File References

- `content.js`
  - `buildHtmlSlidesFromCurrentContent()`
  - `finalizeHtmlSlides()`
  - `calculateHtmlSlideQualityMetrics()`
  - `extractContentUnits()`
  - `createHeuristicHtmlSlidePlan()`
  - `validateAndRepairHtmlSlidePlan()`
  - `renderHtmlSlidesFromPlan()`
- `tests/html-slide-content-units.test.cjs`
- `docs/html-slide-pagination-discussion.html`
- `docs/html-slide-generic-content-units.html`


---

## S4: No-TOC Generic Page Verification (this milestone)

### What Was Verified

A real-browser fixture harness was added at `docs/html-slide-pagination-fixtures.html`.
It shims `window.module` before loading `content.js`, so the class is exported without
`chrome` being present and without auto-instantiating the reader. For each fixture it runs
the real pipeline:

```text
createStructuredOfflineContent(fragment)
→ #reader-main-content
→ buildHtmlSlidesFromCurrentContent()
```

Serve the repo root over HTTP and open `/docs/html-slide-pagination-fixtures.html`
(a `file://` load cannot resolve `../content.js`). Results are also on
`window.__htmlSlideFixtureResults`, and each row has a 開啟燈箱 button that opens the
real lightbox.

### Blocking Defect Found

S1-S3 were a complete no-op at runtime.

Every display path (`refreshContent()`, `hideLoadingState()`, `applyFormattedContent()`)
does `contentContainer.appendChild(this.selectedContent)`, so `#reader-main-content`
always has exactly **one** element child: `div.reader-restructured-content`.
`extractContentUnits(sourceRoot)` therefore returned 1 unit and the heuristic planner
returned 1 slide for every no-TOC page.

Measured before the fix (7 fixtures): unitCount 1, slideCount 1, slide cost 1201-3772.

### Fixes

All in `content.js`, no-TOC path only.

1. `resolveHtmlSlideContentRoot(root, maxDepth)` — descends through single-element-child
   `DIV/SECTION/ARTICLE/MAIN` wrappers to the real content root. Refuses to descend into
   `.reader-table-wrapper`, `.reader-media`, `.reader-attachment-card`,
   `.reader-paragraph-group`, `.reader-list` so units never become `li`/`tr`.
2. `createHtmlSlidePlanningRoot(sourceRoot, options)` — resolves the root, then clones it.
   Planning and rendering both use this detached copy, so DOM normalization never touches
   the live reader view.
3. `splitOversizedContentGroup()` — splits an over-`maxCost` `ul`/`ol`/`.reader-list`/
   `.reader-paragraph-group` into **adjacent sibling** nodes. Continuation `<ol>` gets a
   `start` attribute so numbering does not restart. Order is preserved; nothing is reordered.
4. `splitOversizedTableUnit()` — splits an over-`maxCost` table into adjacent continuation
   tables, repeating `caption` and leading all-`th` header rows. Guarded: refuses when the
   table has any `rowSpan > 1` cell or contains a nested table, so those stay atomic.
5. `createHeuristicHtmlSlidePlan()` — `currentCost += unitCost` (was
   `unitCost || targetCost`, which charged 650 for every zero-cost unit).
6. `createHeuristicHtmlSlidePlan()` — a run of headings with no body unit can no longer be
   closed into its own slide (`currentHasBody` guard). Previously a heading followed by an
   over-budget unit produced a heading-only slide, which
   `removeDuplicateHtmlSlideHeading()` then emptied, and `renderHtmlSlidesFromPlan()`
   dropped — silently losing the heading text.
7. `removeDuplicateHtmlSlideHeading()` — will not remove the heading when it is the only
   text-bearing child of the slide. Defence in depth for the same class of content loss.
8. Untitled plan slides now carry `title: null` instead of `'簡報內容'`, so the lightbox
   uses its existing `第 N 頁` fallback instead of showing an identical side-nav entry per
   slide. `getHtmlSlidePlanTitle()` and `compactHtmlSlidePlanToMaxSlides()` follow.
9. `calculateHtmlSlideQualityMetrics()` — the diagnostics-less fallback now extracts units
   from `resolveHtmlSlideContentRoot(sourceRoot)`, so the TOC path reports a real
   `unitCount` instead of always 1. Metrics only; slide output unchanged.

### Results After the Fix

| Fixture | units | slides | slide costs | textMismatch | overlong |
|---|---|---|---|---|---|
| 無標題長文 | 24 | 2 | 877, 745 | false | 0 |
| 只有一個 h1 的長文 | 23 | 2 | 877, 609 | false | 0 |
| 全 div 內容 | 24 | 2 | 850, 352 | false | 0 |
| list-heavy 頁 | 3 | 3 | 840, 843, 422 | false | 0 |
| table-only 頁 | 4 | 3 | 897, 900, 900 | false | 0 |
| 多表格頁 | 10 | 5 | 750 x 5 | false | 0 |
| 混合標題長文 | 30 | 6 | 270 x 6 | false | 0 |
| TOC 路徑（煙霧測試） | 16 | 4 | 202, 202, 202, 207 | false | 0 |

Lightbox spot checks: slide cards, `第 N 頁` fallback titles, side navigation and the
`n / N` counter all render; split lists and split tables keep item/row order with no
duplicates.

### TOC Path

Not converted. The only shared function touched is `removeDuplicateHtmlSlideHeading()`,
and its new guard only fires when a slide would otherwise become empty — previously such a
slide was dropped entirely, so the change can only prevent content loss. The ESA smoke
fixture still produces `toc-fallback` with one slide per heading.

Note found while reading: in the TOC path both range boundaries share
`.reader-restructured-content` as their container, so `cloneContents()` yields the section
children directly and `removeDuplicateHtmlSlideHeading()` **does** fire there. The earlier
assumption that it was a no-op on the TOC path is wrong.

### Tests

- `tests/helpers/fake-dom.cjs` — minimal mutable fake DOM (appendChild/insertBefore/
  cloneNode/rows/cells/matches) so DOM normalization can be tested without jsdom.
- `tests/html-slide-generic-pagination.test.cjs` — 13 tests covering root resolution,
  live-DOM immutability, list splitting, `<ol>` renumbering, table splitting, the rowspan
  refusal, the heading-only-slide guard, zero-cost units, and null titles.
- `tests/html-slide-content-units.test.cjs` — one expectation updated from `'簡報內容'`
  to `null` (item 8 above). Otherwise untouched.
- `npm run test:html-slides` now runs both `.cjs` files: 25 tests pass. `npm run check` passes.

`tests/helpers/fake-dom.cjs` duplicates the older inline `FakeElement` in
`tests/html-slide-content-units.test.cjs`. Deliberate — merging them was out of scope.

### Known Limitations / Next

- `maxCost: 900` is still a guess. A 16-item list slide still scrolls inside the card;
  the cost model has never been calibrated against real rendered height.
- `addOfflineTableHeadings()` / `deriveOfflineTableTitle()` give every table on a
  multi-table page the same generated heading (e.g. 出席與簽到), so those slides get
  identical titles. This is reader-side behaviour, not pagination; out of scope here.
- Tables with `rowSpan` and nested tables remain single overlong slides by design.
- `possibleTextMismatch` stayed `false` on all 8 fixtures and is now worth trusting as a
  regression signal.

---

## S5: Layout Cost Model Calibration

### Why

S4 measured the real lightbox in Chrome and found `maxCost: 900` was badly wrong for
text: a slide costed at 850-877 actually needed **2.11x-2.74x** the visible height.
Table pages were close (1.12x). The old model charged by **character count**, but rendered
height is driven by **line count**, so it ignored line-wrap waste and per-block margins.

Confirmed by the numbers: 全 div 內容 (17 short blocks, 34 lines) cost *less* than
無標題長文 (13 long blocks, 26 lines) yet overflowed more. 34/26 = 1.31 matches
2.74/2.11 = 1.30 exactly.

### New Model

`estimateHtmlContentCost()` is now a recursive layout walk (`estimateHtmlLayoutCost`)
where **one cost unit is a fixed slice of vertical pixels**, shared by text and tables:

- text block: `ceil(charUnits / charsPerLine) * lineCost + blockCost`
- list item: same, but `listItemCost` (smaller margin)
- table: `tableCost + caption + sum(rows)`
- table row: `maxCellLines * lineCost + tableRowCost`, where each cell only gets
  `charsPerLine / cellCount` of the width
- media: flat `mediaCost`

`getHtmlSlideLayoutMetrics()` derives everything from the actual viewport, so the model
adapts to window size and to the `max-width: 760px` breakpoint where styles.css drops the
body font to 22px. Margins/padding are fixed px in CSS, so they are expressed in pixels and
converted with `costPerPixel`.

Calibrated on Chrome 151 at 1536x739 by measuring rendered geometry:

| Measured | px | Constant |
|---|---|---|
| line-height (28px font x 1.52) | 42.56 | `lineCost: 80` |
| paragraph/heading collapsed margin | ~13 | `blockCost` |
| list item collapsed margin | ~8 | `listItemCost` |
| table cell padding + border | ~20 | `tableRowCost` |
| table vertical margin | ~18 | `tableCost` |
| usable content height (739 - chrome - padding) | 605 | `contentHeight` |

`getHtmlSlidePlanBudget()` is now the single source of truth for
`targetCost / maxCost / minCost / maxSlides`, derived as
`contentHeight * costPerPixel * 0.95`. At 1536x739 that gives
`maxCost 1080, targetCost 810, minCost 194`. Callers can still override via `options`.
The hardcoded `650 / 900 / 160` defaults are gone from the planner, the validator, the DOM
normalizer and the metrics.

### Validation

Cost per rendered pixel, measured across every fixture (model assumes 1.880):

| Fixture | before | after |
|---|---|---|
| 無標題長文 | 2.11x overflow | 1.00, cpp 1.88 |
| 只有一個 h1 的長文 | 2.11x overflow | 1.00, cpp 1.88 |
| 全 div 內容 | 2.74x overflow | 1.00, cpp 1.88 |
| list-heavy 頁 | 1.35x overflow | 1.00, cpp 1.91 |
| table-only 頁 | 1.12x overflow | 1.00, cpp 1.93 |
| 多表格頁 | 1.00 | 1.00, cpp 1.93 |
| 圖文混排頁 | (new) | 1.00 |
| 混合標題長文 | 1.00 | 1.00, cpp 1.90 |
| TOC 路徑（煙霧測試） | 1.00 | 1.00, cpp 1.92 |

Every content type now lands within 3% of the model. Also re-verified under a 720x900
device-metrics override (the 22px branch): `charsPerLine` drops to 28, `contentHeight`
rises to 782, budget rescales to `maxCost 1777`, and all 9 fixtures still measure 1.00.

### Other Fixes in This Milestone

- `splitOversizedTableUnit()` seeded its chunk budget with header rows only, ignoring the
  table's own margin and caption, so continuation tables could exceed `maxCost` (observed
  1096 vs 1080). Now seeded with `tableCost + caption + header rows`.
- `estimateTableLayoutCost()` falls back to `querySelectorAll('tr, .reader-table-row')`
  when `table.rows` is unavailable, so non-native reader rows are costed correctly.
- `getMatchedHtmlSlideTitleTextLength()` compensated for **any** slide title found in the
  source text, but the compensation is only valid when
  `removeDuplicateHtmlSlideHeading()` actually removed it. A `figcaption`-derived title
  stays in the body, so the 圖文混排頁 fixture reported `possibleTextMismatch: true`
  with zero content lost. It now checks the slide body first.
- `estimateContentGroupChildCost()` and `estimateTableRowCost()` were deleted; the
  recursive model makes parent cost exactly the sum of child costs, so the old
  double-counting compensations are no longer needed.

### Tests

`tests/html-slide-generic-pagination.test.cjs` grew 7 tests (32 total across both files):
layout metric defaults, budget derivation and override, line-based cost (two short blocks
cost more than one equal-length long block), list vs paragraph margin cost, table cost
composition, per-cell width wrapping, and the title-compensation fix.

The vm sandbox has no `window`, so the metrics fall back to the calibrated 1536x739
values — the expectations are deterministic.

### Known Gaps

- `mediaCost` is a flat 260px guess. It is the only constant not measured, and the
  1x1 PNG fixture shows cost-per-pixel of 3.4-9.6 for degenerate images. The right fix is
  to scale by `naturalHeight / naturalWidth` against the body width, but a cloned detached
  `<img>` may not have decoded yet, so it needs its own verification pass.
- `getHtmlSlidePlanTitle()` will take a `figcaption` as a slide title, so a
  paragraph-plus-image slide can be labelled 示意圖 N. Defensible, but worth revisiting.
- The 0.95 safety factor is a judgement call, not a measurement.

---

## S6: Media Cost, Slide Titles, and the TOC Path Blocker

### Media Cost Is No Longer a Guess

S5 left `mediaCost` as a flat 260px guess — the only uncalibrated constant. It is now
computed from the image's real aspect ratio:

- `copyRenderedMediaSizes(liveRoot, workingRoot)` copies `naturalWidth/naturalHeight` from
  the on-screen (already decoded) images onto the cloned planning root as
  `data-reader-media-*`. The clone's own `<img>` has not decoded yet, so reading
  `naturalWidth` off the clone returns 0.
- `estimateMediaLayoutCost()` then applies the actual CSS: `max-width: 100%` from
  `.reader-slide-body img`, and — the part that matters most — `max-height: 70vh` from
  `.reader-image`. Without that clamp a tall image is costed as if it rendered at full
  intrinsic height.
- `figcaption` text is costed separately, and `.reader-media`'s 24px top/bottom margins
  (which collapse outside the wrapper) are counted as `mediaMarginCost`.

Measured in Chrome at 1536x739, cost per rendered pixel (model assumes 1.880):

| Fixture | before | after |
|---|---|---|
| 圖文混排頁 (960x540 images) | 1.99 | 1.86 |
| 直式大圖頁 (800x1000 images) | 3.49 | 1.86 |

The 800x1000 case was over-costed by 86% before the `70vh` clamp was modelled.

Fallback behaviour is unchanged when dimensions are unavailable (image not yet decoded,
or non-image media): the flat `mediaCost` still applies.

### Slide Titles No Longer Borrow figcaptions

`getHtmlSlidePlanTitle()` previously fell back to *any* unit with a title, so a slide
holding a paragraph plus an image was labelled with the image's `figcaption`
(示意圖 N), which reads as if the whole slide is about that image. A `figcaption` or
table `caption` is now only used when the slide is exactly that one unit.

### TOC Path Conversion Is Blocked — Do Not Attempt As Planned

S4 recommended converting the TOC path to the plan-rendering path "as a separate safe
refactor, after an equivalence test". **That recommendation is wrong and is withdrawn.**

`processHeaders()` collects sections with `content.querySelectorAll('.reader-header')` at
any depth, and `processTable()` marks single-cell section rows inside tables as
`.reader-header .reader-h2 .reader-table-section`. On real ESA meeting content the section
titles therefore live *inside* a table.

Measured with the new `ESA 表格內區段標題` fixture:

| Section | tag | top-level child? | depth below content root |
|---|---|---|---|
| 會議事項 | H2 | yes | 1 |
| 一、教務處 | TH | **no** | 4 |
| 二、學務處 | TD | **no** | 4 |
| 三、總務處 | TD | **no** | 4 |

The plan contract addresses boundaries as **indexes into `contentRoot.children`**, so it
cannot express a boundary that sits inside a table. The existing TOC path works precisely
because DOM `Range.cloneContents()` can split a partially selected table. Converting it to
the current plan contract would silently lose those boundaries.

Two ways forward, for a later milestone:

1. **(preferred) Normalize first.** In the planning clone, split a table at its
   `.reader-table-section` rows into separate top-level `.reader-table-wrapper` siblings,
   each preceded by a real `<h2>`. This reuses `splitOversizedTableUnit()`'s existing
   sibling-splitting machinery, keeps the plan contract intact, and is exactly the kind of
   ESA-specific knowledge the architecture notes said should become a `siteProfile`.
   It does change ESA rendering, so it needs its own equivalence pass.
2. Extend the plan contract from child indexes to node paths. Much more invasive and it
   breaks the "AI only returns boundaries" simplicity. Not recommended.

Nothing in the TOC path was changed. The two TOC fixtures still produce `toc-fallback`
with one slide per section, coverage 100% / 98%, `possibleTextMismatch: false`.

### Large-Image Slides: Not A Problem, Do Not "Fix" It

A slide holding a single large image measures 627px of content against 605px of usable
height, so it scrolls by ~3% and `overlongSlideCount` flags it. An earlier draft of this
document proposed shrinking the image with a slide-scoped
`max-height` override. **That proposal is withdrawn.**

Images inside HTML slides are already clickable: the slides lightbox binds its own click
handler (`content.js`, the `backdrop.addEventListener('click', ...)` block next to the
attachment handler) that routes `img.reader-image[data-reader-lightbox-image="true"]` into
`openImageLightbox()`. Verified in Chrome — clicking a slide image opens the full zoom/pan
viewer (滾輪縮放・拖曳平移・雙擊放大) on top of the still-open slides lightbox.

So the in-slide rendering is only a preview. Shrinking it would make that preview *worse*
in exchange for removing a 3% scroll that nobody needs to use. styles.css stays untouched.

`overlongSlideCount` firing on a single-atomic-unit slide is expected and is not
actionable by the planner — atomic units are never split by design.

The 圖文混排頁 fixture also alternates a one-paragraph slide with a full-image slide,
because paragraph (184) + image (1166) exceeds the budget. Merging them would make the
image slide scroll by ~19%, which is worse, so the alternation is deliberate.

### Tests

`npm run test:html-slides`: 38 tests pass. Six new tests cover aspect-ratio-based media
cost, the `70vh` clamp, caption cost, the unknown-dimensions fallback,
`copyRenderedMediaSizes()`, and the figcaption-title rule.

---

## S7: Hoisting ESA Section Rows Out Of Tables

S6 showed the TOC path could not move to the plan contract because ESA section titles
(一、教務處) live inside a table, at depth 4, and the contract addresses boundaries as
indexes into `contentRoot.children`. This milestone removes that blocker.

### What Changed

`splitTableAtSectionRows(element)` runs in the planning clone, **before** the size-based
splits (order matters — splitting by budget first cuts in the wrong places). It finds rows
whose single cell carries `.reader-table-section` — the marker `processTable()` already
adds for ESA section rows — and rewrites the table into:

```text
h2.reader-header.reader-h2   一、教務處     <- real top-level heading
div.reader-table-wrapper     案由 1-4       <- that department's rows only
h2 ...                       二、學務處
div.reader-table-wrapper     ...
```

Rows before the first section row stay in the original table. The section row itself is
removed once its text is hoisted into the `<h2>`, so the title still appears exactly once.
Tables with `rowSpan` or nested tables are left alone, as before.

`getHtmlSlidePlanTitle()` now prefers a heading flagged `department` over an earlier
generic heading, so a slide covering 會議事項 -> 一、教務處 is labelled 一、教務處 and the
department stays visible in the side navigation.

### Measured Effect On ESA Content

Same fixture, plan path forced (the real TOC path is untouched):

| | before S7 | after S7 |
|---|---|---|
| top-level units | 2 (h2 + one table) | 7 (3 heading/table pairs + intro) |
| slides | 2 | 3 |
| page 2 title | 一、教務處 | 二、學務處 |
| page 2 content | 學務處案由 3-4 **+ 總務處案由 1-4** | 學務處案由 1-4 |
| side navigation | 會議事項, 一、教務處 | 一、教務處, 二、學務處, 三、總務處 |

Before S7 the plan path mislabelled content: 學務處's items rendered under a repeated
一、教務處 header row, and 二、學務處 disappeared as a label entirely. That is now correct.

### Plan Path vs TOC Path On ESA Content

| | TOC path (current) | plan path |
|---|---|---|
| slides | 4 | 3 |
| page 1 | 會議事項 - **no content**, just the heading | 一、教務處 with 案由 1-4 |
| 一、教務處 | own slide | merged with 會議事項 |
| 二、學務處 / 三、總務處 | own slide each | own slide each |
| side navigation | 會議事項 + 3 departments | 3 departments |

The plan path is now equivalent or better: same per-department slides, no empty
會議事項 slide, and every department present in the navigation.

### Still Not Switched

`buildHtmlSlidesFromCurrentContent()` still routes TOC pages through the Range-based path.
Flipping it is a one-line change now, but it *is* a visible ESA behaviour change (4 slides
becomes 3), so it is left as an explicit decision rather than a side effect of this work.

Prerequisite still open before flipping: ESA tables with `rowSpan` are refused by
`getSplittableTable()`, so their section boundaries remain unaddressable and would silently
collapse into one slide. Either extend the splitter to handle row spans, or keep the Range
path as a fallback whenever `splitTableAtSectionRows()` returns 0 on a table that contains
section rows.

### Tests

44 tests pass. Six new: section rows hoisted in order, leading rows retained, the section
row not duplicated, no-op on tables without section rows, no-op on `rowSpan` tables,
department-boundary planning, and the department-title preference.

---

## S8: TOC Path Switched To The Plan Contract, With A Range Fallback

### Routing

`buildHtmlSlidesFromCurrentContent()` now tries the plan path for TOC pages and falls back
to the original Range path when the boundaries cannot be represented:

```text
entries.length === 0            -> buildHtmlSlidesWithoutToc()      (heuristic-plan)
buildHtmlSlidesFromTocPlan()    -> toc-plan / toc-plan-repaired
  returns null                  -> buildHtmlSlidesFromTocRanges()   (toc-fallback)
```

`buildHtmlSlidesFromTocRanges()` is the previous implementation, moved verbatim. Nothing
about it changed, so the fallback is the exact behaviour that shipped before.

### The Capability Check

`createTocHtmlSlidePlan(entries, units)` matches every TOC entry's text against the
top-level heading units of the normalized planning root, in order, and returns `null` the
moment one does not match. Only when all entries match does it emit a plan whose slide
boundaries are exactly the TOC boundaries, with a 會議資訊 intro slide when the first entry
is not the first unit.

Returning `null` — rather than dropping a boundary — is the whole safety property. The
`rowSpan` case that blocked S7 now takes the Range path automatically, because
`splitTableAtSectionRows()` refuses those tables, so their section titles never become
top-level headings and the match fails.

Verified with two ESA fixtures that differ only by a `rowspan` attribute:

| Fixture | strategy | slides |
|---|---|---|
| ESA 表格內區段標題 | `toc-plan` | 4, same titles as before |
| ESA 表格內區段標題（含 rowspan） | `toc-fallback` | 4, same titles as before |

### What The Switch Buys

Overlong sections are now split. The `ESA 超長處室` fixture puts 24 rows under one
department:

| | Range path (before) | plan path (after) |
|---|---|---|
| slides | 3 | 5 |
| 一、教務處 cost | **3068** (budget is 1080) | 978 + 978 + 978 |
| measured overflow | ~2.8 screens of scrolling | 1.00 on every slide |
| side navigation | 會議事項, 一、教務處, 二、學務處 | 會議事項, 一、教務處, 一、教務處（續 1）, 一、教務處（續 2）, 二、學務處 |

Continuation slides created by `validateAndRepairHtmlSlidePlan()` inherit the split
section's title plus 續, numbered when there is more than one, so the side navigation no
longer shows unattributed 第 N 頁 entries between departments.

`maxSlides` is raised for TOC plans (`max(24, entries + 12)`) so adjacent-merge compaction
can never swallow a boundary the user can see in the navigation.

### Full Fixture Status

13 fixtures, all measured in Chrome at 1536x739:

| strategy | fixtures |
|---|---|
| `heuristic-plan` | 9 generic shapes |
| `toc-plan` | ESA 表格內區段標題, TOC 煙霧測試 |
| `toc-plan-repaired` | ESA 超長處室 |
| `toc-fallback` | ESA 表格內區段標題（含 rowspan） |

Every fixture measures overflow 1.00 except the two single-large-image ones at 1.03, which
is the expected atomic-unit case. `possibleTextMismatch` is false everywhere.

Text coverage on `toc-plan` fixtures reads 94-97% rather than 100% because the department
headings are now real top-level headings and `removeDuplicateHtmlSlideHeading()` removes
them from the body once they become the slide title. `matchedSlideTitleTextLength`
accounts for this, which is why `possibleTextMismatch` stays false.

### Tests

50 tests pass. Six new cover the TOC plan: entry-to-heading mapping with an intro slide,
`null` when an entry has no top-level heading, `null` when entry order does not match
heading order, no intro slide when the first entry is the first unit, continuation titles
with numbering, and the numbering rule itself.

### Remaining

- ESA tables with `rowSpan` still take the Range path, so their overlong sections are still
  unsplittable. Handling row spans in the splitter is the next step if that matters.
- `mediaCost` is still the one uncalibrated constant (flat fallback when an image has no
  measurable dimensions).
- Nothing here calls AI. `aiCachePromptVersion` is untouched and no rendered slide HTML is
  cached.

---

## S9: Verified On A Real ESA Meeting Record

### How

The extension installed in the work browser is the shipping 1.1.0 build, so it does not
contain any of this work. Instead the current `content.js` was injected into a live,
already-authenticated ESA meeting page over CDP:

```js
window.__pagerModule = { exports: {} };
(function (module, chrome) { /* content.js */ })(window.__pagerModule, undefined);
```

Passing `chrome` as `undefined` shadows the global, so the extension bootstrap at the
bottom of the file is skipped and only the class is exported. A detached instance then ran
the real flow against the reader DOM that the shipping extension had already built:
`processHeaders(content)` -> `getHtmlSlideTocEntries()` -> `buildHtmlSlidesFromCurrentContent()`.

Both reader modes were exercised (離線排版 and AI 原文版); they produced identical plans
because the page's TOC resolves to the same six 處室 either way.

No login was automated and nothing on ESA was written to. Only structural metrics were
collected — slide counts, costs, overflow ratios and section titles.

### The Page

6 TOC entries (六位主任), 55 content units, `#reader-main-content` with a single
`.reader-restructured-content.reader-offline-content` child — the same one-child shape that
made S4's fix necessary, confirmed on production content.

### Result

| | Range path (before) | plan path (after) |
|---|---|---|
| strategy | `toc-fallback` | `toc-plan-repaired` |
| slides | 6 | 14 |
| slide costs | 2244, 873, **2399**, 965, 517, **1940** | all 175-1065, budget 1080 |
| slides over budget | 3 of 6 | 0 |
| worst measured overflow | ~2.2 screens | **1.00 — nothing scrolls** |
| `possibleTextMismatch` | false | false |

Side navigation reads:

```text
一、教務主任 / 1.2 文書組記錄 / 一、教務主任（續 1）/ 一、教務主任（續 2）/
二、學務主任 / 三、總務主任 / 附件 1 份 / 3.2 文書組記錄 / 三、總務主任（續）/
四、輔導主任 / 4.2 文書組記錄 / 五、幼兒園主任 / 六、人事主任 / 六、人事主任（續）
```

### Two Cost Model Gaps The Real Page Exposed

Both were invisible in the synthetic fixtures.

**1. Headings are not body text.** styles.css renders `.reader-h1/.reader-h2` at 34px and
`.reader-h3/.reader-esa-subheading` at 30px inside a slide, while `.reader-esa-metadata` is
20px. The model charged every one of them at the 28px body rate, so heading-heavy sections
were under-costed. `getHtmlSlideTextStyle()` now returns a font scale per element and
`estimateTextBlockLayoutCost()` applies it to both the line height and the characters that
fit on a line. Verified against the page: a 20px metadata paragraph now costs 81, matching
its measured 30px render.

**2. Attachment cards are components, not text.** A `.reader-attachments` section with one
card and a 42-character filename rendered at 238px but was costed as 208 (about 111px).
`estimateAttachmentsLayoutCost()` now models the actual CSS: card `min-height: 92px`, grid
`gap: 14px`, column width floor of 360px, section `margin 28x2 + padding 20x2 + border 2x2`,
and a 47px heading row. The same section now costs 449 against a measured 447.

After both fixes, every slide on the real page measures exactly 1.00.

### Fixtures Unaffected

All 13 fixtures keep their previous strategy, slide count and overflow. The only fixtures
above 1.00 remain the two single-large-image ones at 1.03.

### Tests

54 tests pass. Four new: heading vs paragraph vs metadata cost ordering with pinned values,
earlier line wrapping at larger font sizes, attachment cost by card count and grid columns,
and the text fallback for an attachment section with no cards.

### Note For Whoever Runs This Next

The injected module and the opened lightbox live only in that tab; reloading it clears
them. The tab still holds the reader DOM built by the installed extension, which is what
makes this test repeatable without reloading the extension.

---

## S10: Verified On A Real ESA Meeting, Offline And AI

The extension itself was reloaded from disk (it is loaded unpacked with dev mode on, id
`bmkdmlcecdogpfnhbndkinaojdjgkdci`), then driven end to end on a live authenticated ESA
meeting record: selection -> service worker `chrome.tabs.sendMessage` (the same path the
context menu uses) -> reader activation -> the real toolbar button.

Two things worth knowing for the next person:

- Content scripts run in an isolated world, so `window.webReader` is invisible from the
  page's main world. Probe the execution context named `網頁簡報器`, and probe it — a tab
  can keep a stale isolated context from a previous document alongside the live one.
- The ESA SPA does not restore a meeting record from its deep link after a full reload, so
  reloading the tab loses the record. Reload the extension, then have a human navigate.

### Results

Real meeting, 六個處室, measured in Chrome at 1536x739:

| | 離線排版 | AI 精簡版 |
|---|---|---|
| units | 149 | 84 |
| slides | 38 | 15 |
| strategy | `toc-plan-repaired` | `toc-plan-repaired` |
| slides over budget | 0 | 0 |
| worst measured overflow | 1.01 | **1.00** |
| slides that scroll | **none** | **none** |
| `possibleTextMismatch` | false | false |
| unit coverage | 149 units, 0 missing, 0 out of order | 84 units, 0 missing, 0 out of order |

For comparison the old range path on the same content produced 21 slides of which **8 were
over budget**, the worst costing 3828 against a 1080 budget.

Coverage is checked by concatenating every slide's title plus body and confirming each
unit's text appears in it, in order. That is the strongest integrity check in this work and
it passes on production content in both modes.

### Three Cost Model Gaps The Real Page Exposed

**1. `<br>` line breaks were invisible.** ESA writes whole checklists as one paragraph
separated by `<br>`. One paragraph held 136 characters and 6 `<br>`: it renders as 7 lines
(298px) but was costed as 3. `getTextBlockSegments()` now splits a block at its line breaks
and each segment costs at least one line. Worst measured overflow on the real page dropped
from **1.59 to 1.10**.

**2. A `<br>` paragraph can exceed the budget on its own.** One 474-character paragraph
with 12 breaks cost 1224 against a 1080 budget and could not be split, because the planner
never cuts inside an element. `splitOversizedTextBlock()` now splits such a paragraph at
its `<br>` boundaries into adjacent sibling paragraphs, and only when every `<br>` is a
direct child — line breaks nested inside inline elements are left alone. That removed the
last scrolling slide: **1.10 to 1.01**.

**3. Character widths were wrong for Chinese.** Full-width punctuation（，。：、）is exactly
as wide as a Han character but was counted as half. Latin was counted as one third of a
Han character; working backwards from where real lines actually wrap, it must be at least
0.4, so it is now 0.5. This is what closed the AI-version slides from 1.08 to 1.00.

### AI Path

Running AI was authorised for this test. The meeting text was sent to Gemini through the
extension's normal consent dialog; no attachments were sent. The run produced a 精簡版 only
(`originalFormattedContent` stayed null), and the version toggle switches
離線版 -> AI 精簡版 -> back.

The AI shape is flat `H3` / `P` / `OL` with `reader-restructured-content` and, notably,
**no `<br>` at all** — it is list-heavy instead (13 lists, 0 tables, 3339 characters against
the offline version's 7164). Both shapes now paginate cleanly, which is the point: the
pipeline no longer depends on which formatter produced the DOM.

### Fixtures

All 13 fixtures keep their strategy, slide count and overflow through every change in this
milestone. The only ones above 1.00 remain the two single-large-image fixtures at 1.03.

### Tests

62 tests pass. Eight new: `<br>` segmentation, `<br>` line counting, oversized `<br>`
paragraph splitting with order preserved, the under-budget and nested-`<br>` refusals, a
mixed-content fake-DOM helper check, full-width and latin character widths, and the
line-wrap boundary case.

`tests/helpers/fake-dom.cjs` grew text nodes (`FakeText`), `childNodes`, and `firstChild`,
since `<br>` handling needs mixed inline content that the element-only fake could not model.

---

## S11: Splitting Tables That Contain Row Spans

S7 refused to touch any table with a `rowSpan` cell, so those ESA pages always took the
Range path and their overlong sections could never be split. That was the last known gap.

### The Rule

A cut before row *i* is safe only when no cell that started earlier still covers row *i*.
`getTableRowSpanCoverage(rows)` walks every cell once and returns, per row, how many spans
reach into it; `isSafeTableCutIndex()` accepts a row only when that count is zero. Both
splitters now consult it:

- `splitOversizedTableUnit()` closes a chunk only at a safe row. If the budget is exceeded
  on an unsafe row it keeps going until the span ends, so a merged cell is never cut in
  half.
- `splitTableAtSectionRows()` hoists a section title only when its row is safe. A section
  row buried under a span stays in the table, so the TOC entry finds no top-level heading,
  `createTocHtmlSlidePlan()` returns null, and the whole page falls back to Range — exactly
  the behaviour that was there before, but now only for the boundaries that actually need
  it instead of the whole table.

`getSplittableTable()` no longer rejects row spans outright. Nested tables are still
refused; their structure is not knowable from the outside.

### Measured

Two fixtures that differ only in how far the span reaches:

| Fixture | span covers | strategy |
|---|---|---|
| ESA 表格內區段標題（含 rowspan） | rows inside one section | `toc-plan` |
| ESA rowspan 跨越區段邊界 | into the next section's title row | `toc-fallback` |

Both render 4 slides with the same titles and measure overflow 1.00. Before this change the
first one also fell back, losing the ability to split its overlong sections.

The real ESA meeting is unchanged: 38 slides, 0 over budget, worst overflow 1.01, nothing
scrolls, 149 units with 0 missing and 0 out of order.

### Tests

62 tests pass. The two tests that previously asserted "a table with rowSpan is never split"
now assert the stronger contract instead: the table *is* split, and for every cell with
`rowspan="N"` the part it lands in still has N rows from that cell onward; and a section
title covered by a span is not hoisted while safe ones still are.

### Remaining

- Nested tables are still atomic.
- The only fixtures above 1.00 overflow remain the two single-large-image ones at 1.03,
  which is the documented atomic-media case.
- AI slide-plan is still not started, per the original scope note.

---

## S12: A Real Wikipedia Article, And Where Pagination Stops Being Able To Help

ESA content is well-behaved compared with the open web, so the pipeline was pointed at a
long zh.wikipedia.org article (新北市: 34,400 characters, 562 units, 112 lists, 49 figures,
36 tables) through the real extension.

### Two More Cost Gaps, Both General

**`<br>` inside table cells.** S10 taught text blocks to count line breaks but table rows
still derived their height from character count alone. One Wikipedia layout cell held 134
characters and **108 `<br>`** and rendered 5212px tall; the row was costed as if it were a
few lines. Table rows now use the same segmentation, so that row costs 4213 against a
measured 2451px equivalent for its table — honest instead of an order of magnitude out.

**Images inside table cells.** Row cost ignored media entirely, so a two-row infobox
holding seven images measured 2600px and was costed at 569px. `estimateImageLayoutCost()`
was factored out of the media path so a cell can scale an image by its own column width,
and row cost is now `max(cell text lines + cell media)` across cells.

Both matter for ESA too — meeting tables carry both line breaks and images.

### What The Model Is Worth Now

Measured across all 234 slides of that article, comparing predicted against rendered height:

| | |
|---|---|
| median accuracy | **1.02** |
| p10 / p90 | 0.93 / 1.17 |
| slides that scroll | 29 of 234 (12%) |

Of those 29:

| cause | count |
|---|---|
| a **single block is taller than the whole slide** | 18 |
| cost still under-estimated | 4 |
| accumulated small error across blocks | 7 |

The tallest single block on the page is **5397px — 8.6 screens**. No pagination can fix
that: the plan contract never cuts inside an element, and that block is one table row.

That is the honest boundary of this work. Wikipedia infoboxes and layout tables are one
DOM element that renders taller than a screen; making them presentable would mean
*unwrapping* them in the reader's offline formatter, which is a reader-side product
decision, not a pagination one.

### Target Content Is Unaffected

The real ESA meeting is still 38 slides, 0 over budget, worst overflow 1.01, nothing
scrolling, 149 units with nothing missing or reordered. All 14 fixtures keep their strategy,
slide count and overflow.

### Tests

66 tests pass. Four new: `<br>` in a table cell raising the row height, images in a cell
counted and scaled by column width, the unknown-dimensions fallback inside a cell, and
`estimateImageLayoutCost()` scaling by available width while still honouring the 70vh cap.

### If Someone Wants To Push Further

- The 7 "accumulated error" slides would mostly disappear by lowering the 0.95 safety
  factor in `getHtmlSlidePlanBudget()`, at the cost of slightly emptier slides everywhere.
  It was left as measured on the target content, where the worst case is 1.01.
- The 18 un-splittable blocks need a reader-side change, not a planner change.

---

## S13: Layout Constants Measured Instead Of Fitted, And Every Viewport Fits

The cost model was calibrated once at 1536x739 and had grown a lot since (character widths,
line breaks, heading sizes, attachments, cell media). Sweeping the real ESA meeting across
seven viewports exposed three constants that had been *fitted* rather than measured.

### What Was Measured

Reading `clientWidth`/`clientHeight` minus padding straight off the rendered slide body:

| viewport | usable width | usable height |
|---|---|---|
| 1920x1080 | 1838 | 946 |
| 1536x739 | 1454 | 605 |
| 1280x600 | 1198 | 466 |
| 700x800 (compact) | 654 | 699 |
| 420x800 (compact) | 374 | 699 |

The desktop height formula `viewportHeight - 134` was already exact at all three heights.
Three things were not:

- **Paragraph margin.** Modelled as 13px, fitted back in S5. The CSS is `16px` top and
  bottom, collapsing to 16px between siblings. `blockCost` now comes from 16.
- **Compact offsets.** `viewportWidth - 40` and `viewportHeight - 118` were guesses;
  measured they are `- 46` and `- 101`. The width guess was optimistic, which is the unsafe
  direction — it predicted less wrapping than actually happens.
- **The slide's own outer margins.** The first and last block's margins collapse *through*
  `.reader-slide-content`, which has no border or padding, and land outside it. That is
  about 32px per slide that the budget never subtracted. One slide measured 591px of content
  against 605px available — it fitted — and still scrolled, purely because of those two
  escaping margins. `getHtmlSlidePlanBudget()` now subtracts `2 * blockCost`.

### Result

Real ESA meeting, offline formatting, every viewport:

| viewport | chars/line | maxCost | slides | worst overflow | scrolling |
|---|---|---|---|---|---|
| 1920x1080 | 61 | 1629 | 27 | 1.00 | 0 |
| 1536x739 | 48 | 1020 | 41 | 1.00 | 0 |
| 1366x768 | 42 | 1072 | 40 | 1.00 | 0 |
| 1280x600 | 39 | 772 | 56 | 1.00 | 0 |
| 1024x768 | 31 | 1072 | 42 | 1.00 | 0 |
| 760x900 | 30 | 1740 | 33 | 1.00 | 0 |
| 420x800 | 15 | 1513 | 49 | 1.00 | 0 |

Every one of them: nothing scrolls, no slide over budget, no text mismatch, and unit
coverage clean (0 missing, 0 out of order). Slide count adapts sensibly — 27 on a 1080p
display, 56 on a short 600px-tall window.

Before this milestone the same sweep read 1.18 at 420x800, 1.04 at 1280x600 and 1.01-1.03
elsewhere.

All 14 fixtures keep their strategy, slide count and overflow; the only ones above 1.00 are
still the two single-large-image fixtures at 1.03.

### Not Re-Verified

The AI 精簡版 shape was last measured before these constants changed (15 slides, 1.00 at
1536x739). Every change since makes the model *more* conservative, so it should be equal or
better, but it has not been re-run — the ESA tab's content script went stale when the
extension was reloaded, and reloading the tab loses the meeting record.

### Tests

66 tests pass. Six expectations were re-pinned to the measured constants (`blockCost` 24 to
30, `charsPerLine` 47 to 48 and the costs derived from them), and the budget test now
asserts the outer-margin subtraction.

---

## S14: Second Meeting, Both Modes, Every Viewport

S13 left one gap: the AI 精簡版 had not been re-measured after the layout constants were
corrected. A second real ESA meeting closes it, and doubles the real-content sample.

### Finding A Meeting

The ESA meeting list needs 114學年度 ticked before the records show up. That is the way in
for any future session — the SPA still will not restore a meeting from its deep link after
a reload, so navigate rather than reload.

### The Matrix

Meeting id=4611, 13 meeting cards, run through the real extension. Offline formatting gives
115 units of flat `P`/`H2`/`OL`/`UL`; the Gemini 精簡版 gives 92 units of `H3`/`P` with no
`<br>` at all and 2786 characters against the offline version's 5685.

| | 1920x1080 | 1536x739 | 1366x768 | 1280x600 | 1024x768 | 760x900 | 420x800 |
|---|---|---|---|---|---|---|---|
| offline slides | 27 | 36 | 34 | 45 | 38 | 30 | 41 |
| AI slides | 8 | 13 | 13 | 20 | 15 | 10 | 16 |

Every cell of that matrix measures **overflow 1.00 with zero scrolling slides**, no slide
over budget, no text mismatch, and unit coverage clean (0 missing, 0 out of order) — 115
units offline, 92 units on the AI version.

Against the old range path on the same meeting: 22 slides of which **7 were over budget**,
the worst costing 3928 against a 1080 budget.

### Where That Leaves Things

Two real meetings, two formatters, seven viewports each, plus 14 fixtures and a pathological
Wikipedia article with its accuracy quantified. Nothing on target content scrolls; nothing
loses or reorders content.

The AI run itself took about 50 seconds and Gemini returned 7257 characters. The reader's
own safeguard fired during it — "AI 重點版改動了內容，已只保留重點位置並套回格式化版本" —
which is existing behaviour, not something this work introduced.

---

## S15: Absorbing Orphan Slides Without Eating Navigation Labels

`html-slide-ai-plan-design.md` recommended landing the adjacent-merge pass first, since it
needs no AI. Measuring the real meetings first showed the problem was actually two:

| symptom | measured |
|---|---|
| a slide whose whole body is 3 characters | 「三、教學組（續 3）」 on meeting 4611 |
| a section that is one short line | 「三、親職組」, 42 characters |
| slides under `minCost` | 5 on 4611, 6 on 4622 |

### The Rule That Matters

Merging is only safe if it never removes a label the user navigates by. Plan slides now
carry `generatedTitle: true` when the title was invented by the system — the 會議資訊 intro,
a `（續 N）` continuation, the 簡報內容 fallback. **Only those can be absorbed.** A slide
titled from real content is never merged away, which is why 「三、親職組」 is still its own
slide and should be.

An AI-produced plan carries no such marker, so every title a model chooses counts as real
and is likewise safe from merging.

### Two Passes

`rebalanceHtmlSlideTails()` runs first. Greedy chunking fills the early slides and leaves
whatever remains in the last one, which is how a 3-character slide happens. It pulls units
back from the previous slide until the tail clears `minCost`, and only across a boundary
whose second side is a `（續 N）` continuation — same section, so nothing lands under the
wrong heading.

`mergeUnderBudgetHtmlSlides()` runs second and absorbs what is left: an adjacent pair where
one side is under `minCost`, at least one side has a generated title, and the combined cost
stays within `maxCost`. It deliberately does not repack slides that are already reasonable —
the guard is `costOf(first) >= minCost && costOf(second) >= minCost → skip`.

### Result

| | before | after |
|---|---|---|
| meeting 4611 slides under `minCost` | 5 | **1** |
| meeting 4622 slides under `minCost` | 6 | **2** |
| worst overflow, both meetings | 1.00 | 1.00 |
| `overlongSlideCount` | 0 | 0 |
| `possibleTextMismatch` | false | false |
| unit coverage | 0 missing, 0 out of order | 0 missing, 0 out of order |

Strategy strings now read `toc-plan-repaired-rebalanced-merged`, so which passes fired is
visible in the metrics.

Every remaining short slide on both meetings has a real section title. All 14 fixtures keep
their strategy, slide count and overflow.

### Tests

75 tests pass. Nine new: merging a generated-title slide, refusing to merge two real
titles, refusing when the combination exceeds `maxCost`, chaining consecutive continuations,
structural validity after merging, pulling units back into a short tail, refusing to
rebalance across a real title, refusing to empty the previous slide, and refusing a pull-back
that would exceed `maxCost`.
