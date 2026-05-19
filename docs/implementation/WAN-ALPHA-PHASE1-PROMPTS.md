# Wan-Alpha v2.0 — Phase 1 Prompt Set

> **Companion to:** [`TRANSPARENT-ANIMATION-BIBLE.md`](../product/TRANSPARENT-ANIMATION-BIBLE.md) §8 Phase 1, §11.
> **Purpose:** the canonical 30-prompt benchmark used to decide the Phase 1 → Phase 2 kill-gate (§9.1 of the bible).
> **Status:** ready to execute.
> **Owner:** founder.

---

## 1. How To Use This Document

1. Read [`TRANSPARENT-ANIMATION-BIBLE.md`](../product/TRANSPARENT-ANIMATION-BIBLE.md) §7, §8, §9, §11 first. This document is the *test plan*; the bible is the *strategy*.
2. Set up a throwaway harness per the bible §8 Phase 1 step 2. **Do not** wire this into the production worker. Plain script. Plain output directory.
3. Run **every prompt 3 times** with different seeds (or different runs if seeds aren't supported by the chosen provider).
4. For each generation, fill in the per-prompt result block below.
5. After all 30 prompts × 3 runs = **90 generations**, fill in the summary in §6.
6. Take that summary to the §9.1 kill-gate decision in the bible.

**Total expected cost:** ~$30–$100 at $0.30–$1.00/clip. Hard ceiling: **$500** (bible §10.1).

---

## 2. Wan-Alpha Prompt Conventions

Per the [Wan-Alpha repo](https://github.com/WeChatCV/Wan-Alpha) prompt-writing tip, every prompt MUST specify:

1. The background is **transparent**.
2. The **visual style** (realistic / cartoon / pixel-art / anime / neon / hand-drawn / etc.).
3. The **shot type** (close-up / medium shot / wide shot / extreme close-up).
4. A clear description of the **main subject and its motion**.

All 30 prompts below follow this structure. Generation parameters baseline (override only when noted):

| Parameter             | Value |
| --------------------- | ----- |
| Frames                | 81    |
| FPS                   | 16    |
| Sampling steps        | 4     |
| Resolution            | 832×480 (or 480×832 portrait per use case) |
| Guidance scale        | 1.0   |
| LoRA ratio            | 1.0   |
| `alpha_shift_mean`    | 0.05  |

Aspect ratio per use case (matches what `/app/animations` exposes):

| Use case             | Aspect | Resolution |
| -------------------- | ------ | ---------- |
| stream_alert         | 16:9   | 832×480    |
| stinger_transition   | 16:9   | 832×480    |
| mascot_reaction      | 1:1    | 624×624    |
| logo_sting           | 16:9   | 832×480    |
| lower_third          | 16:9   | 832×480    |
| video_callout        | 1:1    | 624×624    |
| creator_overlay      | 9:16 portrait or 1:1 | 480×832 or 624×624 |

---

## 3. Scoring Rubric

Each generation is scored on the bible §11.1 metrics. Reproduced here for reference:

| # | Metric                          | Score 1 | Score 5 |
| - | ------------------------------- | ------- | ------- |
| 1 | Internal motion                 | Static / rigid translation only | Multiple components move independently |
| 2 | Alpha temporal stability        | Halos, breathing matte, flicker | Rock-solid edges across frames |
| 3 | Subject identity stability      | Character morphs / drifts | Recognisably same subject end-to-end |
| 4 | No rigid-translation masquerade | Whole image translates | Internal articulation visible |
| 5 | OBS / editor compatibility      | Won't import or alpha broken | Imports cleanly into both |
| 6 | Loop seam (where applicable)    | Visible jump | Seamless |
| 7 | Brand palette fidelity          | Off-palette / wrong colors | Matches prompt intent |

**Aggregate:** mean of the 7 scores per generation, rounded to 1 decimal. A prompt **passes** if its best-of-3 aggregate ≥ **4.0**.

---

## 4. Per-Prompt Result Template

Copy this block under each prompt and fill it in:

```
Run 1 (seed: ___): aggregate ___/5
  motion __, alpha-stab __, identity __, no-translate __, compat __, loop __, palette __
  notes: ___
Run 2 (seed: ___): aggregate ___/5
  motion __, alpha-stab __, identity __, no-translate __, compat __, loop __, palette __
  notes: ___
Run 3 (seed: ___): aggregate ___/5
  motion __, alpha-stab __, identity __, no-translate __, compat __, loop __, palette __
  notes: ___
Best of 3: ___/5  →  PASS / FAIL
Cost: $___ total / $___ avg per clip
Latency: ___ min avg per clip
Artifact: <path-or-link>
```

---

## 5. The 30 Prompts

Format for each prompt:
- **ID** — short code, used in result tracking.
- **Prompt** — the exact string sent to Wan-Alpha.
- **Tests** — which §11.1 metrics this is designed to stress.
- **Expected hard parts** — failure modes to watch for.
- **Pass-specific criteria** — what must be true *for this prompt* beyond the aggregate ≥ 4.0.

---

### 5.1 Mascot reactions (5 prompts)

**Tests:** fine alpha edges (hair, fur, cloth), character identity stability, subtle internal motion.

#### MR-01 — Fox with flowing tail fur

> **Prompt:**
> *This video has a transparent background. Medium shot. A stylized orange fox character standing upright, with a long flowing fluffy tail. The tail sways gently from side to side, individual fur strands catching the motion. The fox blinks slowly and tilts its head curiously. Soft cartoon style with clean outlines. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7
- **Expected hard parts:** fur edge stability, tail moving independently of body (not whole-image translation), eye blink (most models freeze the eye region).
- **Pass-specific criteria:** tail must move independently of body; blink must be visible; no haloing on fur.

```
[result block]
```

---

#### MR-02 — Anime girl with twin braids

> **Prompt:**
> *This video has a transparent background. Medium shot. An anime-style girl with long blue twin braids and a pink hoodie, smiling and waving with her right hand. The braids sway softly with her arm motion. Clean anime line art style. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7
- **Expected hard parts:** independent braid motion, hand articulation, identity stability across braid swing.
- **Pass-specific criteria:** waving hand and braids must move independently; face identity must be stable.

```
[result block]
```

---

#### MR-03 — Robot mascot with antennae and indicator lights

> **Prompt:**
> *This video has a transparent background. Close-up shot. A friendly white-and-blue cartoon robot mascot with two antennae on its head. The antennae wobble back and forth, the small spheres at their tips glowing softly and pulsing. Two indicator lights on the robot's chest pulse in a slow rhythm. Clean 3D-cartoon style. The background is transparent.*

- **Tests:** 1, 2, 4, 7 (less identity, more multi-component motion)
- **Expected hard parts:** semi-transparent glow on antenna tips and chest lights, antennae moving independently of body.
- **Pass-specific criteria:** glow must be semi-transparent (not opaque blobs); antennae and chest lights must pulse out of phase or independently from body.

```
[result block]
```

---

#### MR-04 — Cartoon dragon puffing smoke

> **Prompt:**
> *This video has a transparent background. Medium shot. A small green cartoon dragon sitting upright, puffing soft white smoke from its nostrils. The smoke rises and dissipates with semi-transparent edges. The dragon's tail flicks gently behind it. Cute cartoon style with bold outlines. The background is transparent.*

- **Tests:** 1, 2, 3, 4 (this is the canonical "semi-transparent FX" stress test)
- **Expected hard parts:** smoke must be semi-transparent and motion-coherent (not a sticker), tail moves independently of body.
- **Pass-specific criteria:** smoke is *not* opaque; smoke edges have soft alpha falloff; tail flicks visibly.

```
[result block]
```

---

#### MR-05 — Pixel-art warrior with cloak

> **Prompt:**
> *This video has a transparent background. Medium shot. A pixel-art style hooded warrior holding a sword, standing in an idle stance. The cloak ripples gently as if in a soft breeze. The warrior subtly breathes — chest rising and falling. Pixel art style, 16-bit aesthetic. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7 (identity is hard for pixel art — model may smooth it)
- **Expected hard parts:** preserving pixel-art style under diffusion (high risk of being smoothed into "pixel-ish"), cloak rippling without rigid translation.
- **Pass-specific criteria:** style must remain pixel-art (chunky pixels visible), cloak rippling is independent of body.

```
[result block]
```

---

### 5.2 Stinger transitions (5 prompts)

**Tests:** semi-transparent FX, independent particle motion, vibrant glow / smoke / energy. **This is the category that opaque-video + matting can never solve, and the one that proves Wan-Alpha is real.**

#### ST-01 — Magic burst with sparkles

> **Prompt:**
> *This video has a transparent background. Wide shot. A vibrant golden magic burst at the center of frame, expanding outward with dozens of sparkles flying in all directions. The sparkles have soft glowing trails and semi-transparent edges. The burst pulses brightly then fades. Fantasy magical style. The background is transparent.*

- **Tests:** 1, 2, 4 (semi-transparent particles are the canonical fail mode for v1)
- **Expected hard parts:** dozens of independently-moving sparkles, semi-transparent trails, glow falloff.
- **Pass-specific criteria:** at least 5+ sparkles must move at *different* trajectories; glow trails must have soft alpha; the burst must visibly evolve over time, not just translate.

```
[result block]
```

---

#### ST-02 — Ink splash dispersing

> **Prompt:**
> *This video has a transparent background. Close-up shot. A black ink splash starts as a single drop, then rapidly expands outward with irregular, jagged edges. As it spreads, the color gradually lightens and the edges become semi-transparent and feathery. Special effects style. The background is transparent.*

(This is essentially the Wan-Alpha paper's own showcase prompt, included as a calibration baseline. If this fails, the harness is wrong.)

- **Tests:** 1, 2, 4, 7
- **Expected hard parts:** irregular edge motion, semi-transparent feathering, alpha falloff over time.
- **Pass-specific criteria:** ink edges are non-circular and irregular; alpha softens at edges over time; *no rigid translation pattern*.

```
[result block]
```

---

#### ST-03 — Cyberpunk energy streaks

> **Prompt:**
> *This video has a transparent background. Wide shot. Vibrant neon cyan and magenta energy streaks crossing the frame diagonally, leaving glowing motion trails behind. The streaks pulse with electric brightness and the trails fade with semi-transparent alpha. Cyberpunk neon style. The background is transparent.*

- **Tests:** 1, 2, 4, 7
- **Expected hard parts:** glow trails with alpha falloff, multiple streaks moving independently, color fidelity (cyan + magenta is unforgiving).
- **Pass-specific criteria:** at least 3 streaks visible with distinct trajectories; trails have soft alpha; colors don't desaturate.

```
[result block]
```

---

#### ST-04 — Smoke cloud rolling forward

> **Prompt:**
> *This video has a transparent background. Medium shot. A volumetric cloud of grey smoke rolls forward toward the viewer, billowing and unfurling, with semi-transparent wisps trailing behind it. As it advances the smoke gradually thins and dissipates at its edges. Realistic smoke effect style. The background is transparent.*

- **Tests:** 1, 2, 4 (canonical "matting can never solve this" test)
- **Expected hard parts:** volumetric smoke is *the* test of true RGBA generation. Any matting-based path produces a flat sticker.
- **Pass-specific criteria:** smoke must have *internal* density variation (not uniform); edges must be soft and semi-transparent; the cloud must visibly billow, not just translate.

```
[result block]
```

---

#### ST-05 — Glass shatter

> **Prompt:**
> *This video has a transparent background. Wide shot. A pane of glass at the center of the frame shatters outward into dozens of sharp shards that fly toward the camera. The shards have realistic transparent edges with subtle refractive highlights. Realistic VFX style. The background is transparent.*

- **Tests:** 1, 2, 3 (each shard is its own component)
- **Expected hard parts:** shards must move independently along distinct trajectories, transparent glass material, edge highlights.
- **Pass-specific criteria:** ≥ 8 distinct shards visible with distinct trajectories; shards are at least partially transparent (not opaque blocks).

```
[result block]
```

---

### 5.3 Logo stings (4 prompts)

**Tests:** subject identity stability is paramount — a logo MUST remain readable through animation. Controlled motion only; no morphing the brand.

#### LS-01 — Particle-assembled text logo

> **Prompt:**
> *This video has a transparent background. Medium shot. The bold sans-serif text "STREAM" assembles from glowing particles flying in from outside the frame, settling into the final word. Once assembled, the text pulses with a soft cyan glow. Modern minimalist motion-graphics style. The background is transparent.*

- **Tests:** 3 (identity), 1, 2, 7
- **Expected hard parts:** text legibility on assembly; glow that doesn't break alpha; particles moving independently.
- **Pass-specific criteria:** the final word is **readable as "STREAM"**; final-frame text shape is correct (not "STRFAM" or wobbly).

```
[result block]
```

---

#### LS-02 — Geometric circle logo with chromatic burst

> **Prompt:**
> *This video has a transparent background. Medium shot. A clean geometric circular logo composed of three concentric rings rotates into place from off-frame, settling at the center. Once settled, a chromatic accent burst (red, blue, green offsets) pulses outward from the rings and fades. Minimalist vector style. The background is transparent.*

- **Tests:** 3, 1, 2, 7
- **Expected hard parts:** preserving geometric precision through rotation; chromatic burst with semi-transparent falloff.
- **Pass-specific criteria:** rings remain circular (not elliptical artifacts); chromatic burst is recognisable as a chromatic accent, not a generic blob.

```
[result block]
```

---

#### LS-03 — Hand-drawn signature ink reveal

> **Prompt:**
> *This video has a transparent background. Medium shot. A hand-drawn signature-style logo reading "Aria" writes itself stroke-by-stroke in flowing black ink, as if drawn by an invisible hand. Once complete, a small gold sparkle appears at the end of the final stroke. Hand-drawn ink illustration style. The background is transparent.*

- **Tests:** 3, 1, 2, 7
- **Expected hard parts:** stroke-by-stroke reveal (hardest motion type — model may just fade in); ink edge alpha; final shape legibility.
- **Pass-specific criteria:** final word is readable as "Aria"; ink reveal is *progressive* (not crossfade); sparkle has semi-transparent edges.

```
[result block]
```

---

#### LS-04 — Neon-outlined gaming logo with electric arcs

> **Prompt:**
> *This video has a transparent background. Wide shot. A neon-outlined hexagonal gaming logo flickers on, the neon glow stabilising. Once stable, small electric arcs occasionally jump between the logo's edges, with semi-transparent blue-white glow. Neon arcade style. The background is transparent.*

- **Tests:** 3, 1, 2, 7
- **Expected hard parts:** neon glow with proper alpha falloff (not flat solid); electric arcs are short-lived independent components; flicker without breaking identity.
- **Pass-specific criteria:** hexagon shape is preserved; ≥ 1 electric arc visible during the clip; glow falloff has soft alpha.

```
[result block]
```

---

### 5.4 Stream alerts (5 prompts)

**Tests:** multi-component coordination — character + text + FX all on one canvas. Text legibility under motion is the killer constraint (most generative video models scramble text).

#### SA-01 — Owl mascot with confetti

> **Prompt:**
> *This video has a transparent background. Medium shot. A cute purple owl mascot pops up into frame from below, wings outstretched. The bold text "FOLLOWED!" appears beside it in vibrant yellow. Colorful confetti pieces (pink, blue, green) fall around the owl with semi-transparent edges. Cheerful cartoon style. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7 (all of them)
- **Expected hard parts:** text legibility ("FOLLOWED!" must remain readable), independent confetti motion, owl identity through pop-up motion.
- **Pass-specific criteria:** the word "FOLLOWED!" is **readable** (this is hard); ≥ 5 confetti pieces with distinct trajectories; owl identity stable.

```
[result block]
```

---

#### SA-02 — Trophy with sparkle aura

> **Prompt:**
> *This video has a transparent background. Medium shot. A golden trophy character with a smiling face stands at center, surrounded by a soft sparkling aura. Above it the text "NEW SUB!" floats in bold blue with subtle bobbing motion. Sparkles continuously pop in and out around the trophy with semi-transparent glow. Stylized 3D-cartoon style. The background is transparent.*

- **Tests:** 1, 2, 3, 7
- **Expected hard parts:** text legibility, aura with soft alpha, sparkles popping in/out independently.
- **Pass-specific criteria:** "NEW SUB!" is readable; aura is semi-transparent (not opaque halo); ≥ 3 sparkles cycle through their lifespan in the clip.

```
[result block]
```

---

#### SA-03 — Ghost with raid alert

> **Prompt:**
> *This video has a transparent background. Medium shot. A friendly translucent white ghost character waves cheerfully, its lower body semi-transparent and slightly wavy. The bold purple text "RAID INCOMING!" shimmers in beside it with a subtle chromatic shimmer. Cartoon spooky style. The background is transparent.*

- **Tests:** 1, 2, 3, 7 (the *ghost itself* is semi-transparent — a brutal alpha test)
- **Expected hard parts:** the ghost's body must be semi-transparent (varying alpha across the body), waving hand independent of body, text legibility.
- **Pass-specific criteria:** ghost body has visible alpha gradient (not opaque); waving hand articulates; "RAID INCOMING!" is readable.

```
[result block]
```

---

#### SA-04 — Coin mascot with donation alert

> **Prompt:**
> *This video has a transparent background. Medium shot. A golden coin character with a smiling face bounces up and down at the left of frame. To the right, the bold green text "DONATION!" appears with small gold sparkles bursting around the letters. Stylized cartoon style. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7
- **Expected hard parts:** independent motion of coin (bouncing) and sparkles (bursting), text legibility, no rigid translation of whole frame.
- **Pass-specific criteria:** coin bounces *independently* of sparkle motion; "DONATION!" is readable; ≥ 4 distinct sparkle bursts.

```
[result block]
```

---

#### SA-05 — Heart character with thanks

> **Prompt:**
> *This video has a transparent background. Medium shot. A red heart character with a sweet face pulses in a heartbeat rhythm at center frame. The cursive text "THANKS!" appears beside it in soft pink with a gentle glow. Small heart particles drift upward around the character with semi-transparent alpha. Romantic cute style. The background is transparent.*

- **Tests:** 1, 2, 3, 7
- **Expected hard parts:** rhythmic pulse (must look like a heartbeat, not a generic scale), text rendering of cursive script, drifting particles with alpha.
- **Pass-specific criteria:** pulsing has a *rhythm* (not constant motion); "THANKS!" is readable in some legible cursive; ≥ 3 drifting hearts visible.

```
[result block]
```

---

### 5.5 Lower thirds (4 prompts)

**Tests:** restraint. These appear during long stretches of video; motion that distracts is a fail. Subtle, professional, text-readable, alpha-clean.

#### LT-01 — Minimalist gradient bar

> **Prompt:**
> *This video has a transparent background. Wide shot, lower third composition. A clean horizontal bar at the bottom of the frame containing the text "ARIA STREAMS" in white. The bar has a subtle dark-to-purple gradient that very gently shifts hue over time, like a slow breathing motion. Modern minimalist broadcast style. The background is transparent.*

- **Tests:** 2, 3, 7 (motion intentionally subtle — score motion as "appropriate," not "maximal")
- **Expected hard parts:** keeping motion *subtle* (most diffusion models over-animate), text legibility, gradient stability.
- **Pass-specific criteria:** "ARIA STREAMS" readable throughout; gradient shift is *subtle* (<10% perceptual change); no jitter on bar edges.

```
[result block]
```

---

#### LT-02 — Hand-drawn paper-tear

> **Prompt:**
> *This video has a transparent background. Wide shot, lower third composition. A torn piece of beige paper with rough hand-drawn edges sits at the bottom of the frame, with the hand-written text "Today's Topic" appearing on it as if being written. The paper edges have subtle jitter as if hand-drawn frame by frame. Hand-drawn illustration style. The background is transparent.*

- **Tests:** 1, 2, 3, 7 (text-write motion is hard)
- **Expected hard parts:** progressive text reveal (vs crossfade), torn paper edge alpha, hand-drawn jitter that is intentional not chaotic.
- **Pass-specific criteria:** text reveals progressively; final reads "Today's Topic"; torn edges have clean alpha.

```
[result block]
```

---

#### LT-03 — Glassmorphism panel

> **Prompt:**
> *This video has a transparent background. Wide shot, lower third composition. A frosted-glass rectangular panel slides in smoothly from the left bottom, semi-transparent with a soft frosted blur effect at its edges. Once in place, the white text "Live Now" fades in with a small white particle trail flowing horizontally behind it. Modern UI / glassmorphism style. The background is transparent.*

- **Tests:** 2, 3, 7 (the frosted panel itself is semi-transparent — alpha must be variable, not 0/255 binary)
- **Expected hard parts:** frosted-glass material is the canonical alpha gradient test; particle trail with falloff.
- **Pass-specific criteria:** panel has visible alpha gradient (not solid); "Live Now" readable; particle trail visible with semi-transparent tail.

```
[result block]
```

---

#### LT-04 — Neon lower third with pulsing accent line

> **Prompt:**
> *This video has a transparent background. Wide shot, lower third composition. A black bar at the bottom of frame with a thin neon-cyan accent line above it. The text "Aria // Variety Streamer" appears in white. The accent line softly pulses brighter and dimmer with a slow rhythm. Neon dark-mode style. The background is transparent.*

- **Tests:** 1, 2, 3, 7
- **Expected hard parts:** neon glow with alpha falloff, pulse rhythm consistency, text rendering.
- **Pass-specific criteria:** "Aria // Variety Streamer" is readable; accent line pulses (not constant); neon glow is semi-transparent.

```
[result block]
```

---

### 5.6 Video callouts (4 prompts)

**Tests:** two distinct components moving with directional intent. Callouts are about *pointing at* something; the asset has a job to do.

#### VC-01 — Cartoon hand pointing with speech bubble

> **Prompt:**
> *This video has a transparent background. Square shot. A stylized cartoon hand with a pointing index finger enters from the left side of the frame, jabbing rightward to indicate something off-screen. Above the hand a white rounded speech bubble appears with the bold text "LOOK HERE!" in black. The bubble bounces gently. Cartoon comic style. The background is transparent.*

- **Tests:** 1, 3, 4, 7 (two-component independence)
- **Expected hard parts:** hand and speech-bubble must move on *different* trajectories, text legibility, alpha on speech-bubble outline.
- **Pass-specific criteria:** hand and bubble move with distinct motion patterns; "LOOK HERE!" is readable.

```
[result block]
```

---

#### VC-02 — Spinning arrow with badge

> **Prompt:**
> *This video has a transparent background. Square shot. A bold red arrow points diagonally toward the lower-right corner. Beside its tail, a yellow circular badge with the text "NEW!" rotates slowly. The arrow has a subtle wiggle to draw attention. Bold marketing-graphics style. The background is transparent.*

- **Tests:** 1, 3, 4, 7
- **Expected hard parts:** independent rotation of badge vs arrow wiggle; text "NEW!" readable through rotation.
- **Pass-specific criteria:** badge clearly rotates while arrow wiggles independently; "NEW!" legible at its moment of facing forward.

```
[result block]
```

---

#### VC-03 — Peeking character with thought bubble

> **Prompt:**
> *This video has a transparent background. Square shot. A small cute cartoon dinosaur character peeks in from the left edge of the frame, only the head and one paw visible. Above it a thought bubble appears containing a small lightbulb icon. The dinosaur blinks and the lightbulb flickers softly with a warm glow. Cartoon kawaii style. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7
- **Expected hard parts:** partial-character framing (model may "complete" the body and break the peek), independent blink + flicker, semi-transparent glow.
- **Pass-specific criteria:** dinosaur stays partially off-frame; blink visible; lightbulb flicker visible with soft glow.

```
[result block]
```

---

#### VC-04 — Highlighted price tag with ribbon

> **Prompt:**
> *This video has a transparent background. Square shot. A bold yellow price tag with the text "$9" pops into the center of the frame with a small bounce. A red ribbon attached to the top of the tag waves gently as if in a breeze. Small gold sparkles burst around the tag intermittently. E-commerce promo style. The background is transparent.*

- **Tests:** 1, 2, 3, 4, 7
- **Expected hard parts:** ribbon must wave independently of tag bounce; sparkles must be *intermittent* not continuous; tag identity stable.
- **Pass-specific criteria:** ribbon wave is independent of tag motion; ≥ 2 distinct sparkle bursts; "$9" readable.

```
[result block]
```

---

### 5.7 Creator overlays (3 prompts)

**Tests:** subtlety. These sit on screen for the entire stream; any motion must be *barely there*. Fail mode is "obnoxious." Score motion as appropriate-to-context, not maximal.

#### CO-01 — Webcam frame with pulsing border

> **Prompt:**
> *This video has a transparent background. Portrait shot. A rectangular webcam frame outline at the center of the frame, with a thin gradient border (purple-to-pink) that very subtly pulses brighter and dimmer in a slow ambient rhythm. The interior of the frame is fully transparent. The pulse is gentle, never distracting. Modern broadcast UI style. The background is transparent.*

- **Tests:** 2 (alpha stability is paramount), 7, restraint
- **Expected hard parts:** the frame INTERIOR must remain transparent (not fill in); pulse must be subtle; border alpha clean.
- **Pass-specific criteria:** interior is fully transparent throughout; pulse is *subtle* (would not distract a viewer for 30 minutes); no flicker on border.

```
[result block]
```

---

#### CO-02 — Pixel-art companion creature idling

> **Prompt:**
> *This video has a transparent background. Portrait shot. A tiny pixel-art slime creature with a smiling face sits in the lower portion of the frame, idly bobbing up and down with a slow breathing rhythm. It blinks every few seconds. The rest of the frame is fully transparent. 16-bit pixel art style. The background is transparent.*

- **Tests:** 1, 2, 3, 7 (pixel-art preservation is hard)
- **Expected hard parts:** preserving pixel-art aesthetic, independent breathing + blinking on small character, rest of frame staying transparent.
- **Pass-specific criteria:** style remains chunky pixel-art; blink visible; breathing has rhythm; rest of frame transparent.

```
[result block]
```

---

#### CO-03 — Floating particles around circular frame

> **Prompt:**
> *This video has a transparent background. Square shot. A thin circular gold ring at the center of the frame. Around the ring, small soft golden particles drift slowly upward and outward with semi-transparent alpha and subtle glow. The ring itself is static. The interior of the ring is fully transparent. Elegant ambient style. The background is transparent.*

- **Tests:** 1, 2, 4, 7 (particle independence + interior transparency)
- **Expected hard parts:** particles must drift *independently*; ring INTERIOR must remain transparent; particles must be semi-transparent.
- **Pass-specific criteria:** ≥ 5 particles with distinct drift directions; ring interior transparent; ring itself stable (not jittering).

```
[result block]
```

---

## 6. Phase 1 Summary Tables (fill in after the run)

### 6.1 Per-prompt pass/fail

| ID    | Use case             | Best aggregate | Pass? | Notes |
| ----- | -------------------- | -------------- | ----- | ----- |
| MR-01 | mascot_reaction      |                |       |       |
| MR-02 | mascot_reaction      |                |       |       |
| MR-03 | mascot_reaction      |                |       |       |
| MR-04 | mascot_reaction      |                |       |       |
| MR-05 | mascot_reaction      |                |       |       |
| ST-01 | stinger_transition   |                |       |       |
| ST-02 | stinger_transition   |                |       |       |
| ST-03 | stinger_transition   |                |       |       |
| ST-04 | stinger_transition   |                |       |       |
| ST-05 | stinger_transition   |                |       |       |
| LS-01 | logo_sting           |                |       |       |
| LS-02 | logo_sting           |                |       |       |
| LS-03 | logo_sting           |                |       |       |
| LS-04 | logo_sting           |                |       |       |
| SA-01 | stream_alert         |                |       |       |
| SA-02 | stream_alert         |                |       |       |
| SA-03 | stream_alert         |                |       |       |
| SA-04 | stream_alert         |                |       |       |
| SA-05 | stream_alert         |                |       |       |
| LT-01 | lower_third          |                |       |       |
| LT-02 | lower_third          |                |       |       |
| LT-03 | lower_third          |                |       |       |
| LT-04 | lower_third          |                |       |       |
| VC-01 | video_callout        |                |       |       |
| VC-02 | video_callout        |                |       |       |
| VC-03 | video_callout        |                |       |       |
| VC-04 | video_callout        |                |       |       |
| CO-01 | creator_overlay      |                |       |       |
| CO-02 | creator_overlay      |                |       |       |
| CO-03 | creator_overlay      |                |       |       |

### 6.2 Per-use-case roll-up

| Use case             | Prompts | Passing | % pass |
| -------------------- | ------- | ------- | ------ |
| mascot_reaction      | 5       |         |        |
| stinger_transition   | 5       |         |        |
| logo_sting           | 4       |         |        |
| stream_alert         | 5       |         |        |
| lower_third          | 4       |         |        |
| video_callout        | 4       |         |        |
| creator_overlay      | 3       |         |        |
| **Total**            | **30**  |         |        |

### 6.3 Per-metric roll-up (mean across all 90 generations)

| Metric                            | Mean score |
| --------------------------------- | ---------- |
| 1. Internal motion                |            |
| 2. Alpha temporal stability       |            |
| 3. Subject identity stability     |            |
| 4. No rigid-translation masquerade|            |
| 5. OBS / editor compatibility     |            |
| 6. Loop seam                      |            |
| 7. Brand palette fidelity         |            |

### 6.4 Cost & latency summary

| Metric                              | Value |
| ----------------------------------- | ----- |
| Total generations                   | / 90  |
| Total spend                         | $     |
| Mean cost per clip                  | $     |
| Mean wall-clock latency per clip    | min   |
| Provider used                       |       |
| GPU type (if self-hosted)           |       |
| Wan-Alpha version                   | v2.0  |
| Conditioning mode (T2V or I2V)      |       |

### 6.5 Failure mode log

Free-form. Capture every failure mode observed across the 90 runs, with frequency. This becomes the spec for v2's motion-QA module in Phase 2.

| Failure mode                            | Count | Use cases affected | Notes |
| --------------------------------------- | ----- | ------------------ | ----- |
| Text rendering scrambled                |       |                    |       |
| Whole-image rigid translation           |       |                    |       |
| Halo / breathing matte on edges         |       |                    |       |
| Identity drift                          |       |                    |       |
| Style collapse (e.g. pixel art smoothed)|       |                    |       |
| Missing component (e.g. no sparkles)    |       |                    |       |
| Color desaturation                      |       |                    |       |
| Off-prompt content                      |       |                    |       |
| Other:                                  |       |                    |       |

---

## 7. Decision Template (the §9.1 kill-gate)

Fill this after §6 is complete. Take to the bible §9.1.

```
Phase 1 result against bible §9.1 gate:

[ ] ≥ 70% of 30 prompts pass (best-of-3 aggregate ≥ 4.0)
[ ] Per-clip cost ≤ $1.00 (acceptable) or ≤ $0.50 (target)
[ ] Per-clip latency ≤ 15 min (acceptable) or ≤ 5 min (target)
[ ] No fundamental disqualifying failure mode (license, watermark, etc.)

Verdict: PASS / FAIL

If PASS → proceed to Phase 2 (renderer replacement).
If FAIL → §9.3 pivot decision:
  [ ] Wait & retry in 3 months on next Wan-Alpha version
  [ ] Pivot to layered procedural (§4.3) — run Phase 1.5 spike
  [ ] Kill animation product, double down on transparent stills

Owner sign-off: ___________________  Date: ___________
```

---

## 8. Notes For The Operator Running This

- **Save every output.** Even fails. Phase 2 needs them as test fixtures.
- **Write notes during scoring**, not after. Rolling memory across 90 clips is unreliable.
- **Manual scoring is honest scoring.** Do not let "I want this to pass" pressure inflate scores. The point of this exercise is to find the truth, not to validate the bible.
- **Keep cost telemetry per call.** Most providers expose it in the response; if not, log timestamps and reconcile against billing.
- **Try one I2V (image-to-video) experiment** even if Wan-Alpha v2.0 doesn't ship I2V — feed the still output of our existing transparent-still generator into TransPixeler or a Wan-Alpha I2V branch if available. This is the workflow we ultimately want for branded animations.
- **Stop early if it's clearly failing.** If the first 10 prompts all fail badly, you have your answer; don't burn the remaining $50 of budget.
- **Stop early if it's clearly passing.** If the first 15 prompts all pass at ≥ 4.5, the gate is decided; the remaining 15 can be a confidence pass rather than a question.

---

**End of Phase 1 prompt set.** When complete, link results back to [`TRANSPARENT-ANIMATION-BIBLE.md`](../product/TRANSPARENT-ANIMATION-BIBLE.md) §9.1.
