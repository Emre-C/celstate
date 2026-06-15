// Web harness for the Celstate living controls. It renders the SAME pure core
// (control.js) the React Native components drive — buttonTransform, springStep,
// foliageTransform, thumbXForValue — so what you see and measure here is the
// actual runtime motion logic, not a re-implementation. Purpose: capture genuine
// rendered "feel" frames and real frame-rate evidence on a true GPU surface.
//
// On the device, press progress is animated by Reanimated's native `withSpring`
// using PRESS_SPRING_CONFIG / RELEASE_SPRING_CONFIG. Here the same configs are
// integrated by the core's `springStep`, so the rebound shown is the documented
// spring, not a re-tuned look-alike. This is a web RUNTIME measurement of the
// shared core — an honest proxy that de-risks the C-gate; it does not replace
// iOS/Android device testing.
import {
  buttonTransform,
  foliageTransform,
  springStep,
  thumbXForValue,
  valueForThumbX,
  DEFAULT_AMBIENT_BREATH,
  BUTTON_FOLIAGE,
  BUTTON_PRESS,
  PRESS_SPRING_CONFIG,
  RELEASE_SPRING_CONFIG,
  SLIDER_THUMB_RADIUS,
} from "../../packages/living-ui-runtime/dist/index.js";

const $ = (id) => document.getElementById(id);

// ---- press spring (the shared core integrator + the shared device configs) -
let pressTarget = 0;
let pressState = { value: 0, velocity: 0 };
function stepSpring(dtMs) {
  const config = pressTarget === 1 ? PRESS_SPRING_CONFIG : RELEASE_SPRING_CONFIG;
  pressState = springStep(pressState, pressTarget, config, dtMs);
}

// ---- slider state ----------------------------------------------------------
const SLIDER_WIDTH = 296; // matches .slider width in index.html
const TRACK = { start: SLIDER_THUMB_RADIUS, end: SLIDER_WIDTH - SLIDER_THUMB_RADIUS };
let sliderValue = 0.5;

// ---- fps meter -------------------------------------------------------------
let frames = 0;
let measuring = false;
let measureFrames = 0;
let measureStart = 0;
let lastFps = 0;
let fpsWindowStart = 0;

function startMeasure() {
  measuring = true;
  measureFrames = 0;
  measureStart = performance.now();
}
function endMeasure() {
  measuring = false;
  const elapsed = performance.now() - measureStart;
  return { frames: measureFrames, elapsedMs: elapsed, fps: (measureFrames / elapsed) * 1000 };
}

let prev = performance.now();
function frame(now) {
  const dt = now - prev;
  prev = now;
  frames++;
  if (measuring) measureFrames++;

  // rolling fps for the on-screen meter
  if (now - fpsWindowStart >= 500) {
    lastFps = (frames / (now - fpsWindowStart)) * 1000;
    frames = 0;
    fpsWindowStart = now;
    $("fps").textContent = `${lastFps.toFixed(1)} fps`;
  }

  stepSpring(dt);

  // Button body — the REAL buttonTransform field, driven by the REAL spring.
  const t = buttonTransform(pressState.value);
  $("livingBtn").style.transform =
    `translateY(${t.translateY}px) scaleX(${t.scaleX}) scaleY(${t.scaleY})`;

  // Foliage breathing — the REAL foliageTransform + shared BUTTON_FOLIAGE config.
  const back = foliageTransform(now, BUTTON_FOLIAGE.back, DEFAULT_AMBIENT_BREATH);
  $("foliageBack").style.transform = `translateY(${back.translateY}px) scale(${back.scale})`;
  const front = foliageTransform(now, BUTTON_FOLIAGE.front, DEFAULT_AMBIENT_BREATH);
  $("foliageFront").style.transform = `translateY(${front.translateY}px) scale(${front.scale})`;

  // Slider thumb — REAL thumbXForValue.
  const x = thumbXForValue(sliderValue, TRACK);
  $("livingThumb").style.transform = `translateX(${x - SLIDER_THUMB_RADIUS}px)`;
  $("livingFill").style.width = `${x}px`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- pointer interaction ---------------------------------------------------
const btn = $("livingBtn");
btn.addEventListener("pointerdown", () => {
  pressTarget = 1;
});
window.addEventListener("pointerup", () => {
  pressTarget = 0;
});

const railArea = $("livingRail");
let dragging = false;
function setFromClientX(clientX) {
  const rect = railArea.getBoundingClientRect();
  sliderValue = valueForThumbX(clientX - rect.left, TRACK);
  $("sliderVal").textContent = sliderValue.toFixed(3);
}
railArea.addEventListener("pointerdown", (e) => {
  dragging = true;
  setFromClientX(e.clientX);
});
window.addEventListener("pointermove", (e) => {
  if (dragging) setFromClientX(e.clientX);
});
window.addEventListener("pointerup", () => {
  dragging = false;
});

// ---- automation surface for measurement (preview_eval) --------------------
window.__harness = {
  press() {
    pressTarget = 1;
  },
  release() {
    pressTarget = 0;
  },
  pressValue: () => pressState.value,
  pressDepthKappa() {
    // observed height ratio at full press == buttonTransform(1).scaleY
    return buttonTransform(1).scaleY;
  },
  setSlider(v) {
    sliderValue = Math.max(0, Math.min(1, v));
    $("sliderVal").textContent = sliderValue.toFixed(3);
    return thumbXForValue(sliderValue, TRACK);
  },
  thumbExpectedPx() {
    return thumbXForValue(sliderValue, TRACK);
  },
  thumbActualPx() {
    const m = /translateX\(([-0-9.]+)px\)/.exec($("livingThumb").style.transform);
    return m ? Number(m[1]) + SLIDER_THUMB_RADIUS : null;
  },
  rollingFps: () => lastFps,
  startMeasure,
  endMeasure,
  constants: { BUTTON_PRESS, DEFAULT_AMBIENT_BREATH, PRESS_SPRING_CONFIG, RELEASE_SPRING_CONFIG, TRACK },
  ready: true,
};
document.body.dataset.harnessReady = "1";
