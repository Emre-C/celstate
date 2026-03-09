# Transparent Background QA

> **Status:** Research backlog
>
> **Purpose:** Track the work required to verify that Celstate outputs truly preserve transparent backgrounds, including internal voids such as donut holes, cutouts, and other fully transparent negative space.

---

## Why This Exists

A generated asset can look correct at first glance and still be wrong in an important way:

- the outer background is transparent
- but internal holes are partially filled
- or semi-opaque haze remains inside negative space
- or anti-aliased edges leak unwanted background pixels

Examples:

- swiss cheese holes must stay transparent
- donut holes must stay transparent
- ring-shaped objects must remain open in the center
- letterforms or icons with cutouts must preserve those cutouts

This is a product-quality problem, not just a cosmetic detail.

---

## Desired Outcome

We need a QA process that can identify when a "transparent background" result is not actually production-usable.

The process should eventually help us answer:

- Is the alpha channel present?
- Is the external background transparent?
- Are internal holes and negative spaces also transparent?
- Are there halos, contamination, or semi-opaque leftovers that break usability?
- When confidence is low, can the output be routed to manual review or automatic retry?

---

## Failure Modes We Need To Detect

### Missing Transparency

- Image exported without meaningful alpha channel
- Fully opaque background despite a "transparent" promise

### Incomplete Background Removal

- Background remains in corners or around silhouette edges
- Soft haze remains around subject

### Internal Hole Failure

- Center of donut is filled
- Holes in cheese are filled
- Hollow objects become solid
- Small cutouts collapse due to poor masking

### Edge Quality Failure

- White or dark halo around edges
- Jagged alpha boundaries
- Semi-transparent contamination where fully transparent pixels are expected

---

## Why This Is Hard

We cannot assume one generic rule will work for all outputs.

Some subjects genuinely contain:

- semi-transparent materials
- shadows
- soft edges
- motion blur
- thin structures

So the QA system must distinguish between:

- valid soft alpha
- invalid leftover background
- legitimate internal transparency
- accidental holes caused by over-removal

---

## Candidate QA Layers To Evaluate

These should be treated as complementary research tracks, not final design.

### Layer 1: Basic File Validation

- output format supports alpha
- alpha channel exists
- image dimensions and export integrity are correct

This catches obvious failures but not semantic ones.

### Layer 2: Alpha Mask Topology Checks

Research points toward direct analysis of the alpha mask as a strong foundation.

Areas to evaluate:

- connected components in the foreground mask
- connected components in the transparent regions
- detection of enclosed transparent holes
- ratio of fully transparent, semi-transparent, and opaque pixels

This is especially relevant for the donut-hole / swiss-cheese problem because the issue is fundamentally topological, not just visual.

### Layer 3: Edge & Matte Quality Checks

Relevant research in alpha matting emphasizes perceptual metrics such as:

- gradient-oriented edge quality
- connectivity / structural integrity

These appear more useful than simple pixel-difference metrics when judging whether a mask is visually and structurally correct.

### Layer 4: Semantic Validation

Pure alpha-mask inspection may still miss intent. For example:

- a wheel spoke opening
- a handle opening
- cutout typography
- jewelry or lattice work

We may need a semantic or vision-assisted validation layer that asks whether expected negative spaces were preserved.

### Layer 5: Human Review For Low Confidence Cases

Certain outputs may always require a review queue rather than a binary automated pass/fail.

---

## Candidate Signals For Automated QA

These need research and threshold tuning before they can be trusted:

- proportion of fully transparent pixels
- proportion of nearly transparent pixels
- number and size distribution of enclosed transparent regions
- unexpected opaque pixels inside large interior voids
- alpha edge sharpness / contamination indicators
- mismatch between expected silhouette complexity and observed mask simplification

---

## Open Research Questions

- Can we infer expected internal holes from prompt semantics alone?
- Should we require an explicit mask generation step so the QA system evaluates the mask directly rather than only the PNG?
- How should we treat legitimate semi-transparent materials like glass, smoke, or soft fabric edges?
- When should the system auto-retry versus flag for review?
- Should we store QA scores per generation for later analytics and alerting?
- What false-positive rate is acceptable before QA becomes a usability problem itself?

---

## Potential Inputs To A Future QA Pipeline

- final RGBA asset
- alpha channel extracted from the asset
- intermediate segmentation / mask outputs if available
- prompt metadata
- model/provider metadata
- optional low-resolution thumbnail for faster analysis

---

## Where This Connects To Observability

Transparent-background QA should not live in isolation. It should feed the broader observability system:

- QA failures should be visible as structured events
- repeated QA failures by model/provider should trigger investigation
- QA pass rate should be tracked over time
- manual review outcomes should feed back into future threshold tuning

This is especially important because users may silently abandon bad outputs instead of reporting them.

---

## Research Findings To Preserve

Recent image-matting evaluation work still points to structural metrics such as **connectivity** and edge-focused metrics as more meaningful than naive pixel metrics for matte quality.

Research also suggests that direct alpha-mask analysis is a natural place to look for boundary quality and topology problems, which makes it relevant for preserved-hole validation.

This supports investigating a QA approach that combines:

- deterministic alpha-mask topology checks
- edge-quality scoring
- semantic review for ambiguous cases

---

## Suggested Research Work Before Implementation

1. Collect a benchmark set of good and bad transparent-background outputs
2. Label examples involving internal holes, thin structures, haze, and edge halos
3. Evaluate deterministic alpha-mask checks for hole preservation
4. Evaluate whether semantic or vision-assisted review improves ambiguous cases
5. Define what should happen after a QA failure: retry, block, warn, or review

---

## Non-Goals For This Document

- Not defining the final QA algorithm
- Not choosing a specific CV library or model yet
- Not setting pass/fail thresholds yet
- Not implementing the QA pipeline yet

This document exists to keep the requirement visible and prevent "transparent background" from being treated as a solved binary capability.
