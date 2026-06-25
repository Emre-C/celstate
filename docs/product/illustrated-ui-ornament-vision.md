# Illustrated UI Ornament Vision

## Status

This is the canonical direction for Celstate illustrated UI work.

Celstate does **not** generate full application screens. Celstate generates
transparent ornament assets for known slots in a real application. The host app
owns layout, scrolling, safe zones, text, controls, accessibility, and
interaction. Celstate owns alpha-native visual craft.

Core rule:

```text
Code owns layout. Celstate owns transparent art layers.
```

## Target

The target is a real UI composed with alpha-native illustrated ornaments:

- **Alpha-native vignette**: faded scenery, such as buildings and foliage near a
  header, generated with transparent edges already present in the asset.
- **Scroll content layer**: foliage or vines placed in document/content flow so
  the user scrolls into and away from it. It is not a fixed viewport frame.
- **Transparent ornament asset**: a PNG or SVG with real transparent edges,
  designed for a declared slot and allowed to overlap only the safe ornamental
  region.
- **Hand-drawn semantic icon**: a small icon for a real action, such as create
  event, invite member, requests, or calendar. Simple line-and-wash icons may be
  SVG. Painterly icons should be transparent PNGs.
- **Parchment/editorial UI surface**: the application chrome remains ordinary
  accessible UI, but it can sit on warm paper, soft borders, and restrained
  hand-drawn accents.

The desired effect is close to an illustrated mobile app screen whose UI remains
usable: the art enriches the page without becoming the page.

## Rejected Paths

Do not restart these without explicit founder approval:

- One-shot generated UI screens.
- Generated full-screen app mockups that contain text, controls, or layout.
- Fixed viewport foliage frames that sit on screen edges forever.
- Layout inference or safe-zone detection as the main strategy.
- Control-skin rigs, runtime-owned buttons/sliders, or Living UI components.
- Human 2AFC / F-gate aliveness studies for this decision.
- Video generation, animation workers, sprite sheets, or runtime motion bundles.
- Any path that requires complex masking of an opaque generated background.

These paths were retired because they optimize the wrong artifact. The product
gap is not "generate a UI." The product gap is "add alpha-native illustrated art
to a real UI without breaking layout."

## Slot Contract

Every illustrated asset must be generated for a declared slot before generation.
The slot contract must specify:

- Slot name and purpose.
- Target dimensions and responsive scaling rule.
- Anchor: e.g. top-right header, section-bottom content, card-leading icon.
- Safe content region that the asset must not obscure.
- Allowed opacity range.
- Whether the asset may be SVG or must be transparent PNG.
- Failure modes that stop iteration.

The asset should arrive with real alpha and any intended edge fade already baked
into the transparent pixels. Code may apply simple opacity, transform, and
clipping, but code must not depend on complex masking, background extraction, or
computer-vision layout recovery.

## Proof Scope

The first proof is intentionally narrow:

1. `header_village_vignette`: faded illustrated buildings/foliage behind a top
   area, anchored top-right.
2. `bottom_scroll_foliage`: foliage in page content near the bottom, revealed by
   scroll and never fixed to the viewport.
3. `action_icon_calendar`: a hand-drawn semantic calendar/event icon used inside
   a real action card.

Pass/fail is based on integrated screenshots at real mobile size, not isolated
asset beauty. Stop if any slot needs complex masking, repeated agent fiddling, or
layout inference to work.

## Agent Guardrail

Before touching illustrated UI work, read this document and
`docs/product/design-system.md`.

Use this vocabulary:

- transparent ornament asset
- slot
- scroll content layer
- alpha-native vignette

Avoid this vocabulary unless explicitly discussing retired history:

- Living UI
- animation worker
- runtime control
- generated UI
- safe-zone inference
- 2AFC / F-gate
