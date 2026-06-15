# Expo Harness — aliveness 2AFC + on-device gates

This harness renders the living controls next to plain static equivalents so you
can run the two evidence steps the repo cannot run headlessly:

1. **F-gate aliveness 2AFC** (§9.3) — blind forced choice, living vs static.
2. **P/C-gate on-device measurement** — fps / memory / right-size on real iOS + Android.

## Scaffold

```sh
# 1. Create a blank Expo + TS app (this doubles as the §9.2 installability test).
npx create-expo-app@latest celstate-harness -t expo-template-blank-typescript
cd celstate-harness

# 2. Runtime deps.
pnpm add @celstate/living-ui-runtime react-native-reanimated react-native-gesture-handler

# 3. Reanimated babel plugin (last) in babel.config.js:
#    plugins: ['react-native-reanimated/plugin']

# 4. Copy the bundles + harness in.
cp -r ../bundles/celstate-living-button ./components/
cp -r ../bundles/celstate-living-slider ./components/
cp ../bundles/expo-harness/App.tsx ./App.tsx
cp ../bundles/expo-harness/LivingVsStaticScreen.tsx ./LivingVsStaticScreen.tsx
# Fix the two import paths in LivingVsStaticScreen.tsx to ./components/…

# 5. Run.
pnpm expo start --ios     # or --android
```

> `@celstate/living-ui-runtime` is a workspace package. To consume it outside this
> monorepo, `pnpm pack` it (or publish to a private registry) and add the tarball.

## Run the 2AFC

- Recruit **N ≥ 30** viewers. Each taps the control (A or B) that feels *more alive /
  more premium*. Left/right assignment alternates per trial and is recorded blind.
- The score card shows the live preference rate. Export the `trials` array and feed
  the count to `binomialRightTailProbability(livingPreferred, total)` from
  `@celstate/living-ui-runtime`.
- **Pass:** living preferred ≥ 70%, p < 0.05, and no rise in self-reported
  distraction/discomfort vs static.

Record the outcome into each bundle's `qa-report.json` (`pendingHumanOrDevice.aliveness_2afc`),
then assemble the full MVP evidence file and run `pnpm living-ui:evaluate-mvp -- evidence.json`.

## On-device gates (C-gate)

Profile this screen on real devices (1/10/50 instances; densities 1/2/3) and fill
in the `fps_*`, `memory_at_50`, and `right_size_*` rows of the QA reports.
