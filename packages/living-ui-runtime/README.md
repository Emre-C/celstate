# Celstate Living UI Runtime

React Native consumption layer for Celstate living UI assets.

This package consumes the `celstate_living_ui_runtime_v1` manifest emitted by
the animation worker. The pure entrypoint (`@celstate/living-ui-runtime`) covers
manifest validation, sprite-cell math, frame selection, and right-size checks.
The React Native entrypoint (`@celstate/living-ui-runtime/react-native`) renders
Tier 1 sprite sheets through a Reanimated UI-thread frame callback.

## Runtime Contract

- `spriteSheet.frameCount` is expected to sit in the coherent-cell MVP range
  (normally 8-12 cells, hard capped by the generator spike at roughly 6-18).
- `runtime.rightSizePass` is true when the exported cell is not upscaled at the
  target display size and device density.
- Host apps should prefer the WebP sheet when available and keep the PNG sheet
  for inspection/debugging.
- The worker manifest and package types are versioned together by the
  `celstate_living_ui_runtime_v1` pipeline string.

## React Native Usage

```tsx
import { LivingSprite } from "@celstate/living-ui-runtime/react-native";

<LivingSprite
  manifest={manifest}
  source={{ uri: manifestUrlBase + "/" + manifest.exports.spriteSheetWebp }}
/>;
```

The component requires `react-native-reanimated` 4.x. Reanimated worklets run on
the UI thread; the component does not use `setInterval`.

## MVP Evidence Gate

The pure entrypoint also exports `evaluateLivingUiMvp`. Feed it retained worker
generation evidence, physical iOS/Android C-gate measurements, calibrated
thresholds, and the 2AFC study result. It returns a strict pass/fail object with
reason codes for:

- G-gate: founder review, white/black registration, boil, loop seam, frame count,
  honored output size, and crisp-cell recording.
- C-gate: iOS and Android fps at 1/10/50 instances, memory at 50 instances,
  right-size at density 1/2/3, seamless loop, and interaction latency.
- MVP gate: at least four of five in-scope classes pass both gates through a
  runtime component, the aliveness 2AFC clears 70/30 at `p < 0.05`, and
  `B_max`, `epsilon_loop`, and `N_min` are calibrated.

The repo CLI wraps the same evaluator and exits non-zero until the MVP evidence
passes:

```pwsh
pnpm living-ui:evaluate-mvp -- path/to/evidence.json
```

## Verification

Local package checks:

```pwsh
pnpm build:living-ui-runtime
pnpm exec vitest run packages/living-ui-runtime/src/index.test.ts packages/living-ui-runtime/src/evidence.test.ts
```

These checks prove the manifest contract and atlas math. They do not replace
the spike MVP gates: retained generated assets still need G-gate review, C-gate
measurement on real iOS and Android devices, aliveness 2AFC, and calibrated
gate constants.
