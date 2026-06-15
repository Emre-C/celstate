# Celstate Living UI — agent-installable bundles

The MVP product surface from `docs/product/LIVING-UI-ANIMATION-SPIKE.html` §9.1:
a runtime package plus two agent-installable control bundles, motion authored in
Reanimated (model-free), art procedural, theming via manifest tokens.

| Bundle | Primitive | Path | Status |
| --- | --- | --- | --- |
| [`celstate-living-button`](celstate-living-button/) | button | C (procedural) | machine gates ✅ · web proxy measured · 2AFC + device pending |
| [`celstate-living-slider`](celstate-living-slider/) | slider | C (procedural) | machine gates ✅ · web proxy measured · 2AFC + device pending |
| [`expo-harness`](expo-harness/) | — | — | runs the 2AFC + on-device gates |
| [`web-harness`](web-harness/) | — | — | renders the shared core on a real GPU surface for fps/feel proxy measurement |

Each bundle is `Bundle E = (C, M, A, R, Q)`: component, typed manifest, art,
runtime, and QA evidence. The shared runtime is
[`@celstate/living-ui-runtime`](../packages/living-ui-runtime/).

## Why these are runtime-owned, not generated

The §3.9 capability test proved generated sprite sheets cannot reliably own UI
semantics (a button that did not compress: `kappa_press = 0.998`). So per §6/§12,
controls are **runtime-owned from the start** — procedural motion (Path C) here,
with an authored rig (Path B) reserved for high-craft escalation. The manifest
contract enforces this: a control's `motionPath` may never be a sprite sheet.

Generation returns later as a *constrained skinner* (Phase G): it fills the
defined `raster` layer slots in these same rigs; it never owns behaviour.

## Verifying the contract

```sh
pnpm exec vitest run packages/living-ui-runtime/ scripts/living-ui/bundle-contract.test.ts
```

This proves the §3.0 invariants, the manifest contract, and that both shipped
bundles validate. The remaining gates (2AFC aliveness, on-device fps/memory) need
the [`expo-harness`](expo-harness/) on real viewers and devices.

## Measuring the feel on a real surface (web proxy)

The [`web-harness`](web-harness/) renders the *same* pure core the RN components
drive, on a browser GPU surface, so the rebound feel and frame rate can be
measured rather than asserted:

```sh
pnpm build:living-ui-runtime
node bundles/web-harness/serve.mjs   # http://localhost:4178
```

Captured values land in each bundle's `qa-report.json` under
`measuredWebRuntimeProxy`. This is an honest proxy that de-risks the C-gate; it is
**not** the iOS/Android device gate, which stays pending.
