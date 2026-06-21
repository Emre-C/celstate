/**
 * Celstate Living Button — agent-installable bundle entry (§5.1).
 *
 * This file is the import surface an AI coding agent wires into a host app. The
 * behaviour (press / hold / cancel / release, the breathing surround, theming)
 * lives in the shared runtime package; this bundle pins the component plus its
 * machine-verified contract (celstate.manifest.json) and QA evidence
 * (qa-report.json). Motion is runtime-owned and model-free — never a sprite
 * sheet (see LIVING-UI-ANIMATION-SPIKE.html §3.9, §6, §12).
 *
 * Install + setup: see this folder's README.md.
 */
export {
  CelstateLivingButton,
  type CelstateLivingButtonProps,
  type CelstateLivingButtonSkin,
  type LivingControlTheme,
} from "@celstate/living-ui-runtime/react-native";
