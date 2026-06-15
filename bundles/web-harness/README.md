# Web runtime harness — measure the feel, don't claim it

A tiny, dependency-free web page that renders the **same pure core**
(`packages/living-ui-runtime/src/control.ts`) the React Native components drive —
`buttonTransform`, `springStep`, `foliageTransform`, `thumbXForValue` — on a real
browser GPU surface. Its purpose is to convert "architectural claim" rows into
*measured* evidence: genuine frame rate, the real press depth `κ_press`, the
spring rebound, and slider thumb exactness, plus living-vs-static "feel" frames.

It is an honest **proxy** that de-risks the C-gate. It does **not** replace the
§9 device gate — iOS + Android fps/memory/right-size still require the
[`expo-harness`](../expo-harness/) on physical devices.

## Run

```sh
pnpm build:living-ui-runtime         # emits dist/ that the page imports over http
node bundles/web-harness/serve.mjs   # serves the repo root on http://localhost:4178
```

Open <http://localhost:4178> (it redirects to the harness page, keeping the
relative ESM imports valid). The on-screen badge shows rolling fps.

## Why this is the real runtime, not a re-implementation

The device animates press progress with Reanimated's native `withSpring` using
`PRESS_SPRING_CONFIG` / `RELEASE_SPRING_CONFIG`; here the *same* configs are
integrated by the core's `springStep`. The transform field, foliage breath, and
value→position mapping are the exact exported functions. So the only thing the
proxy can't speak to is native device performance — which is exactly what stays
pending.

## Automation surface

`window.__harness` exposes `press()`, `release()`, `pressValue()`,
`pressDepthKappa()`, `setSlider(v)`, `thumbExpectedPx()`, `thumbActualPx()`,
`rollingFps()`, and `startMeasure()` / `endMeasure()` for scripted measurement
(e.g. the preview tools). Captured numbers are recorded in each bundle's
`qa-report.json` under `measuredWebRuntimeProxy`.
