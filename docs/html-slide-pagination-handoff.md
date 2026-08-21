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
