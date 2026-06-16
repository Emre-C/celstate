// Web runtime harness — renders the SHARED hand-authored vector art
// (@celstate/living-ui-runtime/art) driven by the SHARED, tested motion core.
// The leaf paths, palette ramp, and every transform here are the exact data and
// functions the React Native control draws via react-native-svg; only the host
// (DOM <svg> vs react-native-svg) differs. So this is a faithful preview of the
// product's craft, not a separate mockup — and an honest fps/feel proxy.
import {
  buttonTransform,
  springStep,
  foliageTransform,
  ambientDrift,
  pressReaction,
  thumbXForValue,
  valueForThumbX,
  DEFAULT_AMBIENT_BREATH,
  DEFAULT_FIREFLY_DRIFT,
  BUTTON_FOLIAGE,
  PRESS_SPRING_CONFIG,
  RELEASE_SPRING_CONFIG,
} from "../../packages/living-ui-runtime/dist/index.js";
import {
  livingPalette,
  mix,
  tint,
  withAlpha,
  LEAF_PATH,
  LEAF_MIDRIB,
  BUTTON_LEAF_CLUSTER,
  SLIDER_SPROUTS,
  sproutOpenness,
} from "../../packages/living-ui-runtime/dist/index.js";

const NS = "http://www.w3.org/2000/svg";
const PAL = livingPalette("#C2410C");

function S(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  for (const c of kids) e.appendChild(c);
  return e;
}
const $ = (id) => document.getElementById(id);

// ---- shared defs (gradients + soft shadow) --------------------------------
function buildDefs(prefix, pal) {
  const stop = (offset, color, opacity = 1) => S("stop", { offset, "stop-color": color, "stop-opacity": opacity });
  const lin = (id, x2, y2, stops) => S("linearGradient", { id, x1: 0, y1: 0, x2, y2 }, stops);
  const rad = (id, stops) => S("radialGradient", { id }, stops);
  const filter = S("filter", { id: `${prefix}-shadow`, x: "-50%", y: "-50%", width: "200%", height: "200%" }, [
    S("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 5 }),
  ]);
  return S("defs", {}, [
    lin(`${prefix}-body`, 0, 1, [stop(0, pal.accentBright), stop(0.5, pal.accent), stop(1, pal.accentDeep)]),
    lin(`${prefix}-vine`, 1, 0, [stop(0, pal.leafDeep), stop(0.6, pal.accent), stop(1, pal.accentBright)]),
    rad(`${prefix}-bloom`, [stop(0, tint(pal.accent, 0.5), 0.9), stop(1, pal.accent, 0)]),
    rad(`${prefix}-glow`, [stop(0, "#fff7e0", 0.95), stop(0.4, pal.glow, 0.7), stop(1, pal.glow, 0)]),
    filter,
  ]);
}

function leafNode(pal, depth) {
  const fill = mix(pal.leafDeep, pal.leafBright, depth);
  const inner = S("g", { transform: "translate(-12,-24)" }, [
    S("path", { d: LEAF_PATH, fill }),
    S("path", { d: LEAF_MIDRIB, fill: "none", stroke: withAlpha(pal.leafDeep, 0.55), "stroke-width": 1, "stroke-linecap": "round" }),
  ]);
  return S("g", {}, [inner]);
}

// ---- living button ---------------------------------------------------------
function buildButton(svg, pal) {
  const CX = 180, CY = 110;
  svg.appendChild(buildDefs("btn", pal));

  const shadow = S("ellipse", { cx: CX, cy: 150, rx: 92, ry: 11, fill: "#1c1917", opacity: 0.22, filter: "url(#btn-shadow)" });
  const bloom = S("circle", { cx: CX, cy: CY, r: 74, fill: "url(#btn-bloom)", opacity: 0 });

  // Foliage cluster (a bush the body sits within), anchored just below centre.
  const leaves = BUTTON_LEAF_CLUSTER.map((p) => {
    const g = leafNode(pal, p.depth);
    g.dataset.base = `translate(${p.ox},${p.oy}) rotate(${p.rotateDeg}) scale(${p.scale})`;
    return g;
  });
  const cluster = S("g", {}, leaves);
  const clusterAnchor = S("g", {}, [cluster]);

  const bodyRect = S("rect", { x: 86, y: 80, width: 188, height: 60, rx: 17, fill: "url(#btn-body)", stroke: withAlpha(pal.accentDeep, 0.6), "stroke-width": 1 });
  const highlight = S("rect", { x: 95, y: 86, width: 170, height: 22, rx: 11, fill: "#ffffff", opacity: 0.16 });
  const label = S("text", { x: CX, y: 116, "text-anchor": "middle", "font-family": "ui-sans-serif, system-ui, sans-serif", "font-size": 17, "font-weight": 700, fill: "#fff", "letter-spacing": 0.3 });
  label.textContent = "Generate";
  const body = S("g", {}, [bodyRect, highlight, label]);

  const firefly = S("g", {}, [
    S("circle", { cx: 0, cy: 0, r: 12, fill: "url(#btn-glow)" }),
    S("circle", { cx: 0, cy: 0, r: 2.6, fill: "#fff8e7" }),
  ]);

  for (const n of [shadow, bloom, clusterAnchor, body, firefly]) svg.appendChild(n);

  return { CX, CY, shadow, bloom, leaves, cluster, clusterAnchor, body, firefly };
}

function animateButton(refs, now, pressValue) {
  const { CX, CY } = refs;
  const react = pressReaction(pressValue);
  const breath = foliageTransform(now, BUTTON_FOLIAGE.back);

  // Cluster: breathe at rest; recoil + still its breath on press.
  const sway = breath.translateY * react.breathDamping;
  const scale = 1 + (breath.scale - 1) * react.breathDamping;
  refs.clusterAnchor.setAttribute("transform", `translate(${CX},${CY + 8})`);
  refs.cluster.setAttribute("transform", `translate(0,${sway + react.recoilDp}) scale(${scale})`);
  for (const g of refs.leaves) g.setAttribute("transform", g.dataset.base);

  // Body: the real squash field.
  const t = buttonTransform(pressValue);
  refs.body.setAttribute("transform", `translate(${CX},${CY}) translate(0,${t.translateY}) scale(${t.scaleX},${t.scaleY}) translate(${-CX},${-CY})`);

  // Shadow tightens as the key travels down toward the surface.
  refs.shadow.setAttribute("opacity", String(0.22 - pressValue * 0.08));
  refs.shadow.setAttribute("ry", String(11 - pressValue * 3));

  // Light bloom from the press.
  refs.bloom.setAttribute("opacity", String(react.bloom));

  // Firefly drifts above the body; its glow pulses.
  const d = ambientDrift(now);
  refs.firefly.setAttribute("transform", `translate(${CX + d.x},${CY - 34 + d.y}) scale(${0.7 + d.glow * 0.5})`);
  refs.firefly.setAttribute("opacity", String(0.45 + d.glow * 0.55));
}

// ---- living slider ---------------------------------------------------------
const TRACK = { start: 30, end: 330 };
const RAIL_Y = 78;

function buildSlider(svg, pal) {
  svg.appendChild(buildDefs("sld", pal));

  const valText = S("text", { x: 30, y: 26, "font-family": "ui-monospace, monospace", "font-size": 12, fill: PAL.leafDeep, opacity: 0.0 });

  const twig = S("path", { d: `M${TRACK.start} ${RAIL_Y} L${TRACK.end} ${RAIL_Y}`, fill: "none", stroke: mix(pal.leafDeep, "#a8a29e", 0.5), "stroke-width": 4, "stroke-linecap": "round" });
  const vine = S("path", { d: `M${TRACK.start} ${RAIL_Y} L${TRACK.start} ${RAIL_Y}`, fill: "none", stroke: "url(#sld-vine)", "stroke-width": 7, "stroke-linecap": "round" });

  const sprouts = SLIDER_SPROUTS.map((s) => {
    const x = TRACK.start + (TRACK.end - TRACK.start) * s.at;
    const leaf = leafNode(pal, 0.5 + s.at * 0.4);
    const g = S("g", {}, [leaf]);
    g.dataset.x = String(x);
    g.dataset.side = String(s.side);
    g.dataset.scale = String(s.scale);
    return g;
  });
  const sproutLayer = S("g", {}, sprouts);

  const thumb = S("g", {}, [
    S("circle", { cx: 0, cy: 0, r: 19, fill: "url(#sld-glow)" }),
    S("circle", { cx: 0, cy: 0, r: 12, fill: pal.glow ? "#fbf9f4" : "#fff", stroke: pal.accent, "stroke-width": 3 }),
    S("circle", { cx: 0, cy: 0, r: 4, fill: pal.accent }),
  ]);

  for (const n of [twig, vine, sproutLayer, thumb, valText]) svg.appendChild(n);
  return { twig, vine, sprouts, thumb, valText };
}

function animateSlider(refs, now, value, dragging) {
  const x = thumbXForValue(value, TRACK);
  refs.vine.setAttribute("d", `M${TRACK.start} ${RAIL_Y} L${x} ${RAIL_Y}`);

  for (const g of refs.sprouts) {
    const sx = Number(g.dataset.x);
    const side = Number(g.dataset.side);
    const baseScale = Number(g.dataset.scale);
    const at = (sx - TRACK.start) / (TRACK.end - TRACK.start);
    const open = sproutOpenness(value, at);
    const breath = foliageTransform(now + at * 1500, BUTTON_FOLIAGE.front).translateY * 0.5;
    const rot = side * (-18 - open * 30);
    const sc = baseScale * (0.05 + open * 0.95) * 0.7;
    g.setAttribute("transform", `translate(${sx},${RAIL_Y + breath}) rotate(${rot}) scale(${sc})`);
    g.setAttribute("opacity", String(open));
  }

  const pulse = 0.6 + ambientDrift(now).glow * 0.4;
  refs.thumb.setAttribute("transform", `translate(${x},${RAIL_Y}) scale(${dragging ? 1.14 : 1})`);
  refs.thumb.firstChild.setAttribute("opacity", String(dragging ? 1 : pulse));
  refs.valText.setAttribute("opacity", String(0.5 + value * 0.5));
  refs.valText.textContent = `${value.toFixed(2)}`;
  return x;
}

// ---- static baselines (honest: plain, no motion) ---------------------------
function buildStaticButton(svg, pal) {
  svg.appendChild(S("ellipse", { cx: 180, cy: 148, rx: 88, ry: 9, fill: "#1c1917", opacity: 0.16 }));
  svg.appendChild(S("rect", { x: 86, y: 80, width: 188, height: 60, rx: 17, fill: pal.accent }));
  const label = S("text", { x: 180, y: 116, "text-anchor": "middle", "font-family": "ui-sans-serif, system-ui, sans-serif", "font-size": 17, "font-weight": 700, fill: "#fff" });
  label.textContent = "Generate";
  svg.appendChild(label);
}
function buildStaticSlider(svg, pal) {
  const mid = TRACK.start + (TRACK.end - TRACK.start) * 0.5;
  svg.appendChild(S("line", { x1: TRACK.start, y1: RAIL_Y, x2: TRACK.end, y2: RAIL_Y, stroke: "#d8d2c6", "stroke-width": 5, "stroke-linecap": "round" }));
  svg.appendChild(S("line", { x1: TRACK.start, y1: RAIL_Y, x2: mid, y2: RAIL_Y, stroke: pal.accent, "stroke-width": 5, "stroke-linecap": "round" }));
  svg.appendChild(S("circle", { cx: mid, cy: RAIL_Y, r: 12, fill: "#fff", stroke: pal.accent, "stroke-width": 3 }));
}

// ---- assemble --------------------------------------------------------------
const btn = buildButton($("btnSvg"), PAL);
const sld = buildSlider($("sldSvg"), PAL);
buildStaticButton($("btnStatic"), PAL);
buildStaticSlider($("sldStatic"), PAL);

// ---- press spring (shared core integrator + shared device configs) ---------
let pressTarget = 0;
let pressState = { value: 0, velocity: 0 };
let sliderValue = 0.5;
let dragging = false;
let lastThumbX = thumbXForValue(0.5, TRACK);

// ---- fps meter -------------------------------------------------------------
let frames = 0, measuring = false, measureFrames = 0, measureStart = 0, lastFps = 0, fpsWindowStart = 0;
function startMeasure() { measuring = true; measureFrames = 0; measureStart = performance.now(); }
function endMeasure() { measuring = false; const e = performance.now() - measureStart; return { frames: measureFrames, elapsedMs: e, fps: (measureFrames / e) * 1000 }; }

let prev = performance.now();
function frame(now) {
  const dt = now - prev; prev = now; frames++;
  if (measuring) measureFrames++;
  if (now - fpsWindowStart >= 500) {
    lastFps = (frames / (now - fpsWindowStart)) * 1000;
    frames = 0; fpsWindowStart = now;
    $("fps").textContent = `${lastFps.toFixed(1)} fps`;
  }
  pressState = springStep(pressState, pressTarget, pressTarget === 1 ? PRESS_SPRING_CONFIG : RELEASE_SPRING_CONFIG, dt);
  animateButton(btn, now, pressState.value);
  lastThumbX = animateSlider(sld, now, sliderValue, dragging);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- interaction -----------------------------------------------------------
const btnSvg = $("btnSvg");
btnSvg.style.cursor = "pointer";
btnSvg.addEventListener("pointerdown", () => { pressTarget = 1; });
window.addEventListener("pointerup", () => { pressTarget = 0; dragging = false; });

const sldSvg = $("sldSvg");
sldSvg.style.cursor = "pointer";
function setFromClientX(clientX) {
  const rect = sldSvg.getBoundingClientRect();
  const vx = ((clientX - rect.left) / rect.width) * 360; // map css px -> viewBox px
  sliderValue = valueForThumbX(vx, TRACK);
  $("sliderVal").textContent = sliderValue.toFixed(2);
}
sldSvg.addEventListener("pointerdown", (e) => { dragging = true; setFromClientX(e.clientX); });
window.addEventListener("pointermove", (e) => { if (dragging) setFromClientX(e.clientX); });

// ---- automation surface for measurement (preview_eval) --------------------
window.__harness = {
  press() { pressTarget = 1; },
  release() { pressTarget = 0; },
  // Deterministically pose the scene for a reproducible screenshot, independent
  // of the preview's rAF throttling. Holds because it sets the spring at rest on
  // the posed value, so a live frame re-renders the same pose.
  pose(pv = 0, sv = sliderValue, drag = false) {
    pressTarget = pv; pressState = { value: pv, velocity: 0 };
    sliderValue = Math.max(0, Math.min(1, sv)); dragging = drag;
    const now = performance.now();
    animateButton(btn, now, pressState.value);
    lastThumbX = animateSlider(sld, now, sliderValue, dragging);
    $("sliderVal").textContent = sliderValue.toFixed(2);
    return { posed: { pv: pressState.value, sv: sliderValue, drag } };
  },
  pressValue: () => pressState.value,
  pressDepthKappa: () => buttonTransform(1).scaleY,
  setSlider(v) { sliderValue = Math.max(0, Math.min(1, v)); $("sliderVal").textContent = sliderValue.toFixed(2); return thumbXForValue(sliderValue, TRACK); },
  thumbExpectedPx: () => thumbXForValue(sliderValue, TRACK),
  thumbActualPx: () => lastThumbX,
  rollingFps: () => lastFps,
  startMeasure, endMeasure,
  palette: PAL,
  ready: true,
};
document.body.dataset.harnessReady = "1";
