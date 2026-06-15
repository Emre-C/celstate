# Celstate Living Button

An agent-installable React Native control whose body **presses, holds, cancels,
releases, and rebounds**, with a living foliage surround that breathes. Motion is
runtime-owned and model-free (Reanimated, UI-thread) — never a sprite sheet.

This bundle is the `Bundle E = (C, M, A, R, Q)` from the spike:

| Part | Where |
| --- | --- |
| `C` component | `CelstateLivingButton.tsx` (re-exports the runtime component) |
| `M` manifest | `celstate.manifest.json` (typed contract: states, props, layers, timing, theme tokens) |
| `A` art | procedural (runtime-drawn styled layers; no raster to ship for the MVP) |
| `R` runtime | `@celstate/living-ui-runtime` (Reanimated state machine + transform field) |
| `Q` QA | `qa-report.json` (machine gates green; human/device gates marked pending) |

## Install (for a coding agent)

From the host Expo app root:

```sh
pnpm add @celstate/living-ui-runtime react-native-reanimated react-native-gesture-handler
```

1. **Reanimated babel plugin** — add to `babel.config.js` (must be last):

   ```js
   module.exports = { presets: ['babel-preset-expo'], plugins: ['react-native-reanimated/plugin'] };
   ```

2. **Gesture root** — wrap the app once (only needed if you also use the slider, but harmless here):

   ```tsx
   import { GestureHandlerRootView } from 'react-native-gesture-handler';
   export default function App() {
     return <GestureHandlerRootView style={{ flex: 1 }}>{/* … */}</GestureHandlerRootView>;
   }
   ```

3. Copy this folder into the app (e.g. `components/celstate-living-button/`).

## Usage

```tsx
import { CelstateLivingButton } from './components/celstate-living-button/CelstateLivingButton';

<CelstateLivingButton
  label="Generate"
  loading={isLoading}
  disabled={isLoading}
  onPress={handleGenerate}
  testID="generate-button"
/>
```

### Theming (§9.5)

Pass host palette tokens; structural layers (body, shadow) are used as-is,
tintable layers (foliage) multiply the `accent` token. No model call at install.

```tsx
<CelstateLivingButton label="Save" onPress={save}
  theme={{ accent: '#166534', onAccent: '#FFFFFF', surface: '#F0FDF4', border: '#DCFCE7', text: '#14532D' }} />
```

### Accessibility

`accessibilityRole="button"`, `accessibilityState={{ disabled, busy: loading }}`,
spoken label defaults to `label` (override with `accessibilityLabel`).

## What is proven vs pending

- **Proven by machine** (`packages/living-ui-runtime/src/control.test.ts`): every
  observable state, real press compression `kappa_press = 0.92 < 1` (the §3.9 fix),
  passive-center stability, hold/cancel/release semantics, the shared press-spring
  physics, deterministic theming, and the manifest contract. See `qa-report.json`.
- **Measured (web-runtime proxy)**: rendered through the shared pure core on a real
  browser surface (`bundles/web-harness`) — `kappa_press = 0.92` observed with a
  visible compression, a real spring rebound (overshoot to ~1.05), at ~60 fps. This
  de-risks but does **not** replace the device C-gate; see `qa-report.json` →
  `measuredWebRuntimeProxy`.
- **Pending human/device runs**: the 2AFC aliveness study (≥30 blind viewers,
  §9.3) and on-device fps/memory/right-size (C-gate). Use `bundles/expo-harness`
  to run both.
