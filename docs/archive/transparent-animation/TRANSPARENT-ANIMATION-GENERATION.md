# Transparent Animation Generation

## Purpose

This document explains **why** the animation worker builds a real RGBA still before encoding video, and how that connects to difference matting and FFmpeg. For **how to run** the worker (env, commands, artifacts), see [`docs/runbooks/ANIMATION-WORKER.md`](../runbooks/ANIMATION-WORKER.md).

For the **mathematics** of recovering alpha from white/black raster passes (still images), see [`docs/product/image-generation.md`](../product/image-generation.md) — “How It Works” / “The Math”. The animation path reuses the same idea: two solid backgrounds so compositing can be inverted into per-pixel alpha.

## End-to-end pipeline

1. **Generate a still key visual on white** — first raster pass with a pure white background.
2. **Regenerate the same still on black** — second pass with a pure black background, matching subject and composition.
3. **Compare the two passes to reconstruct an alpha mask** — difference matting: where only the background changed, opacity is recovered; where RGB matches, the subject is opaque. Semi-transparent edges fall between those extremes, so edges stay soft instead of a binary cutout.
4. **Produce one transparent PNG reference** — canonical RGBA asset: every pixel is `r, g, b, a`, not just `r, g, b`.
5. **Animate that PNG with deterministic motion** — transforms applied in RGBA space so **every frame carries alpha** without re-inferring boundaries per frame.
6. **Export WebM / MOV / APNG / frame sequence** — FFmpeg packages the already-RGBA frames into formats that support alpha (VP9 with alpha side data, ProRes 4444, APNG, PNG ZIP).

## Why a transparent reference is required

**FFmpeg can encode alpha in several containers, but it cannot invent an alpha channel.** If the only input is opaque RGB video or stills, there is no principled way to recover subject boundaries frame by frame without a separate matting model — which would be slow, uncertain, and inconsistent across frames.

The white/black pair is the trick that turns **model output (RGB only per pass)** into **pixels with real alpha**: if the subject is the same and only the background swaps white ↔ black, the per-channel difference reveals how transparent each pixel should be. Fully opaque subject pixels look the same on both backgrounds. Fully transparent regions track the background (white vs black). Edge pixels blend accordingly.

That yields a **single transparent PNG** that is the single source of truth for **color and transparency** before any motion is applied.

## Why deterministic animation follows the still

For this worker path, motion is **deterministic** ( scripted transforms on the reference ). Each frame is derived from the same RGBA source, so **alpha is inherited for every frame** — there is no per-frame segmentation or guesswork about where the subject ends.

Without that RGBA reference, the worker would only have opaque imagery and would need to guess subject boundaries on **every frame**, which breaks consistency and quality.

## Relationship to QA and scope

- Still-image transparent QA concepts (recomposition checks, retries on white/black passes) are discussed in [`docs/implementation/TRANSPARENT-BACKGROUND-QA.md`](./TRANSPARENT-BACKGROUND-QA.md). The animation worker performs decode-and-verify alpha checks on exported media; see the animation runbook for operational detail.

- **Out of scope for this path:** reconstructing alpha from **opaque generative video** (e.g. off-the-shelf video models) without a dedicated matting stack. That is called out in [`docs/runbooks/ANIMATION-WORKER.md`](../runbooks/ANIMATION-WORKER.md) under **Scope**.

## Summary

| Question | Answer |
|----------|--------|
| Why white and black? | Two known backgrounds make alpha recovery exact for each foreground pixel (see `image-generation.md`). |
| Why a transparent PNG before animation? | Establishes RGBA once; FFmpeg encodes it but does not create alpha from thin air. |
| Why deterministic motion on that asset? | Every frame inherits the same alpha mask logic; no per-frame matte inference. |
