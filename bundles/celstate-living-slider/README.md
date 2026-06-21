# Celstate Living Slider

An agent-installable React Native slider whose **thumb position is a function of
value** (`thumbX = lerp(trackStart, trackEnd, value)`), with a filled rail and a
breathing moss accent. Drag tracks the finger on the UI thread; the reported
value round-trips through the tested pure mapping. Motion is runtime-owned and
model-free — never a sprite sheet.

| Part | Where |
| --- | --- |
| `C` component | `CelstateLivingSlider.tsx` |
| `M` manifest | `celstate.manifest.json` |
| `A` art | procedural (runtime-drawn) |
| `R` runtime | `@celstate/living-ui-runtime` |
| `Q` QA | `qa-report.json` |

## Install (for a coding agent)

```sh
pnpm add @celstate/living-ui-runtime react-native-reanimated react-native-gesture-handler
```

1. **Reanimated babel plugin** (last in the list) in `babel.config.js`:

   ```js
   module.exports = { presets: ['babel-preset-expo'], plugins: ['react-native-reanimated/plugin'] };
   ```

2. **Gesture root is required** — the slider uses `react-native-gesture-handler`,
   so the app must be wrapped once at the root:

   ```tsx
   import { GestureHandlerRootView } from 'react-native-gesture-handler';
   export default function App() {
     return <GestureHandlerRootView style={{ flex: 1 }}>{/* … */}</GestureHandlerRootView>;
   }
   ```

3. Copy this folder into the app (e.g. `components/celstate-living-slider/`).

## Usage

```tsx
import { CelstateLivingSlider } from './components/celstate-living-slider/CelstateLivingSlider';

const [strength, setStrength] = useState(0.5);

<CelstateLivingSlider value={strength} onValueChange={setStrength} min={0} max={1} testID="strength-slider" />
```

Snap to a grid with `step`, theme with palette tokens (the filled rail and moss
use the `accent` token), and disable with `disabled`.

### Generated skin layers (Phase G seam)

The `skin` prop accepts optional transparent raster images for `moss` and `thumb`.
When provided, these replace the procedural placeholders; the runtime's value
geometry, drag tracking, and ambient motion remain unchanged.

```tsx
import { CelstateLivingSlider, type CelstateLivingSliderSkin } from './components/celstate-living-slider/CelstateLivingSlider';

const skin: CelstateLivingSliderSkin = {
  moss: require('./assets/moss.png'),
  thumb: require('./assets/seed-pod.png'),
};

<CelstateLivingSlider value={strength} onValueChange={setStrength} skin={skin} />
```

Generate transparent layers with the G-gate skin probe (`--slots seed` for the
thumb, `--slots background` for moss-like accents).

### Accessibility

`accessibilityRole="adjustable"` with `accessibilityValue={{ min, max, now: value }}`.
The control is focusable and exposes `increment` / `decrement` accessibility
actions, so assistive technology and keyboards adjust the value by one step
(`step` when set, else a tenth of the range) — landing on exactly the values a
drag can reach. Focus shows a ring on the thumb. This makes the §3.0 `focused`
state of `U_slider` operable, not merely declared.

## What is proven vs pending

- **Proven by machine** (`packages/living-ui-runtime/src/control.test.ts`):
  `thumbX(value)` is monotonic and exact within 1px at sampled values, the inverse
  drag mapping round-trips and clamps, step snapping is correct, the AT adjust step
  is snapped/clamped, theming is deterministic across ≥3 palettes, and the manifest
  contract holds. See `qa-report.json`.
- **Measured (web-runtime proxy)**: rendered through the shared pure core on a real
  browser surface (`bundles/web-harness`) — thumb position exact to 0px across the
  range at ~60 fps. This de-risks but does **not** replace the device C-gate; see
  `qa-report.json` → `measuredWebRuntimeProxy`.
- **Pending human/device runs**: 2AFC aliveness (§9.3) and on-device
  fps/memory/right-size (C-gate). Use `bundles/expo-harness`.
