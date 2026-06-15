/**
 * Celstate Living Slider — agent-installable bundle entry (§5.1).
 *
 * The thumb position is a function of value (`thumbX = lerp(trackStart,
 * trackEnd, value)`, §3.0) — value-owned, never sprite-owned. Dragging tracks
 * the finger on the UI thread; the reported value round-trips through the tested
 * pure mapping. Contract: celstate.manifest.json. Evidence: qa-report.json.
 *
 * Install + setup (incl. the required GestureHandlerRootView): see README.md.
 */
export {
  CelstateLivingSlider,
  type CelstateLivingSliderProps,
  type LivingControlTheme,
} from "@celstate/living-ui-runtime/react-native";
