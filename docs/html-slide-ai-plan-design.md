# AI Slide Plan — Design

Status: **implemented.** Recommendation (3) shipped as S15 and the AI call itself as S16 in
`html-slide-pagination-handoff.md`. Written after the pagination quality work landed
(S0–S14); the sections below are the design as approved, with implementation notes marked
inline where reality differed.

## Why Now

The heuristic planner is verified: two real ESA meetings, two formatters, seven viewports
each, plus 14 fixtures — every slide fits, nothing is lost or reordered. What it still does
badly is **semantic**, and that is exactly what a model can do and a cost function cannot:

- It breaks on budget, not on meaning. A 案由 and its 決議 can land on different slides.
- Continuation slides are labelled 「一、教務主任（續 1）」. The side navigation of the real
  meeting reads 一、生教組 / （續 1）/（續 2）/（續 3）/（續 4）— five entries that say
  nothing about what is on them.
- 5–6 slides per meeting come out under `minCost`, usually a heading with one short line,
  because the boundary was forced by the next unit not fitting.

Those are the three things to judge any AI plan against.

## Non-Goals

Carried over from the original scope note and unchanged:

- The AI returns **boundaries, never HTML**. Rendering stays `renderHtmlSlidesFromPlan()`.
- **No reordering.** Slides stay in document order; only adjacent merge and overlong split.
- **No AI call when the lightbox opens.** The plan is produced during the AI processing the
  user already consented to.
- **`aiCachePromptVersion` is not bumped and `webReaderAICache` entries do not change
  shape.** No rendered slide HTML is cached.

## Where It Plugs In

```text
startAIProcessing()
  └─ existing content run  ────────────► simplifiedContent / originalFormattedContent
  └─ requestHtmlSlidePlan()  ──────────► slide boundaries, own cache entry

openHtmlSlidesLightbox()
  └─ primeCachedHtmlSlidePlan()   (reads cache only, never calls AI)
  └─ buildHtmlSlidesFromCurrentContent()
       ├─ TOC page   → AI plan if it keeps every TOC boundary → toc-ai-plan
       │               otherwise createTocHtmlSlidePlan()
       └─ no TOC     → AI plan if structurally valid → ai-plan
                       otherwise createHeuristicHtmlSlidePlan()
```

**Implementation note.** The original diagram left TOC pages untouched, which would have
made the feature inert — every real ESA meeting has a TOC. Instead the AI plan is accepted
on TOC pages too, but only if it keeps **every** TOC section start as a slide start
(`isHtmlSlidePlanRespectingStarts()`). The model may subdivide inside a section and retitle
freely; it can never move or swallow a boundary the user sees in the side navigation. The
required starts are handed to the model in the request as `requiredStarts`.

The plan request is a **separate Gemini call**, not a change to the existing prompt.
Folding it into the existing prompt would change `aiCachePromptVersion`, which is
forbidden — and it would also couple two failure modes that should stay independent: a bad
plan must never cost the user their formatted content.

## The Request

Input is the unit list that already exists — `extractContentUnits()` output — reduced to
what a planner needs. Every field below is already produced today:

```js
{
  budget: { targetCost, maxCost, maxSlides },     // getHtmlSlidePlanBudget()
  units: [
    { i: 0,  kind: 'heading', level: 2, title: '一、生教組', cost: 135 },
    { i: 1,  kind: 'block',   cost: 264, preview: '請各班導師於 9/30 前 ... 列入期末檢核。' },
    { i: 2,  kind: 'atomic',  cost: 897, flags: ['table'], preview: '案由 1 承辦單位 ...' }
  ]
}
```

`preview` is `createContentUnitPreview()` — head 120 chars + tail 60, so a long unit still
shows how it ends. For the real meeting that is 115 units at roughly 60–180 characters
each: **7–12 KB**, against the 5,685 characters of content the existing call already sends.
One extra call of comparable size.

Units whose cost alone exceeds `maxCost` are marked so the model does not waste effort
trying to group them; the validator will split them regardless.

## The Response

Exactly the shape `validateAndRepairHtmlSlidePlan()` already accepts:

```json
{ "slides": [ { "start": 0, "end": 2, "title": "生教組：友善校園週" } ] }
```

Nothing else is read. Any extra keys are ignored.

## Validation

No new validation is needed — the existing chain already covers every failure mode, and it
is pinned by tests:

| Failure | Handled by | Result |
|---|---|---|
| gaps, overlaps, reordering | `isStructurallyValidHtmlSlidePlan()` | whole plan rejected → heuristic |
| non-contiguous unit indexes | same | rejected → heuristic |
| a slide over budget | `validateAndRepairHtmlSlidePlan()` | split by the heuristic, title + 續 |
| too many slides | `compactHtmlSlidePlanToMaxSlides()` | adjacent merge only |
| malformed JSON, timeout, API error | request layer | heuristic, silently |

The strategy string already flows into the metrics, so `ai-plan`,
`ai-plan-repaired` and `heuristic-plan` will be distinguishable in
`lastHtmlSlideQualityMetrics` without any new instrumentation.

## Viewport Independence — The One Real Design Problem

The budget is derived from the viewport: `maxCost` measured 1629 at 1920x1080 and 772 at
1280x600 on the same meeting. A plan cached at one size is wrong at another.

The repair direction already works: a cached plan opened on a **smaller** screen has
overlong slides, and `validateAndRepairHtmlSlidePlan()` splits them. The opposite does not:
on a **bigger** screen the slides are simply sparse, and nothing merges them.

`mergeUnderBudgetHtmlSlides()` now exists (S15) and covers this. It merges **adjacent**
slides, which is inside the existing rule, and makes a cached plan degrade gracefully in
both directions.

What it will not do is drop a title the user can see in the side navigation. Only slides
whose title the system invented — marked `generatedTitle: true` — can be absorbed. **An AI
plan carries no such marker**, so every title a model chooses is treated as real and
survives any later merge. That is the property that makes caching an AI plan across
viewports safe.

## Caching

A separate store, so `webReaderAICache` is untouched:

```js
storage key   'webReaderSlidePlanCache'
entry         { cacheKey, pageKey, contentHash, planVersion, createdAt, slides }
cacheKey      'webreader-slide-plan|{planVersion}|{pageKey}|{contentHash}'
prune         same 5-entry LRU as the AI cache
```

`contentHash` is `getAIProcessingContentHash()`, already implemented — so the plan is
invalidated by exactly the same content changes that invalidate the formatted content.
`planVersion` is this feature's own constant; bumping it is free and does not touch
`aiCachePromptVersion`.

Deliberately **not** stored: rendered slide HTML, titles beyond the plan, anything derived
from the viewport.

## Consent And Cost

The plan call happens inside the AI processing the user already approved through the
existing consent dialog, and the dialog's wording already covers sending the meeting text.
It does mean one more request per AI run, so:

- If the plan request fails or times out, the AI run still succeeds. The plan is optional.
- It should be skippable, so a user who only wants formatted content is not paying for it.
- The existing 16,000-token output cap is far more than a boundary list needs; the request
  should ask for a much smaller cap so a runaway response cannot burn budget.

**Implementation note — this one was wrong.** A small cap (2,000) truncated the response
before any JSON appeared, because the model spends output budget on reasoning first. Two
changes were needed: `background.js` now accepts an allow-listed `responseMimeType` so the
request can ask for `application/json`, and the cap was raised rather than lowered. The
parser also stopped trusting the response to be pure JSON — it brace-matches the object
containing `"slides"` out of surrounding prose.

## How To Judge It

The harness already answers this. For each of the 14 fixtures and both real meetings, in
both formatters:

| Must not regress | Should improve |
|---|---|
| `possibleTextMismatch` false | slides under `minCost` (今天 5–6 per meeting) |
| unit coverage: 0 missing, 0 out of order | side-navigation titles that say something |
| every slide overflow ≤ 1.00 | boundaries that fall on topic shifts |
| `overlongSlideCount` 0 | |

The first column is objective and automated. The second needs a human looking at the side
navigation of a real meeting — which is why the fixture harness has a 開啟燈箱 button.

## Open Questions For The Product Owner

1. **Is a second AI call per run acceptable?** It is the only way to leave
   `aiCachePromptVersion` alone. The alternative is waiting until a prompt version bump is
   wanted for other reasons and folding the plan in then.
2. **Should the AI be allowed to retitle a slide** whose content already starts with a
   heading? Better navigation, but the title stops matching the visible heading.
3. ~~**Should `mergeUnderBudgetHtmlSlides()` land first, on its own?**~~ **Done.** It shipped
   with a companion pass, `rebalanceHtmlSlideTails()`, because the measured problem turned
   out to be two problems. Slides under `minCost` went from 5 to 1 and from 6 to 2 on the
   two real meetings, with no other metric moving. Details in S15.

Recommendation: (1) and (2) are still open. The data from (3) says the remaining sparse
slides are ones with **real section titles** that the merge rule deliberately refuses to
absorb — so what is left for a model to improve is titling and topic-aware boundaries, not
packing. That sharpens the case for (2) and weakens the urgency of the whole feature.
