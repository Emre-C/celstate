# Phase 1.5 — Landing Page Polish

## Problems Identified

### 1. Page Load is Catastrophically Slow

**Root cause: Two things conspiring.**

**A. Auth gate blocks all rendering.**

`+layout.svelte` wraps *every route* — including the landing page — in an auth loading gate:

```svelte
{#if auth.isLoading}
  <div>Loading...</div>
{:else}
  {@render children()}
{/if}
```

`setupConvexAuth()` initializes a Convex client connection, wires up `client.setAuth(fetchAccessToken)`, and runs an `$effect` that reads `window.location.search` for OAuth callback codes. Even on a clean visit to `/` with no `?code` param, the Convex client must establish a WebSocket connection to `PUBLIC_CONVEX_URL` before `isLoading` resolves to `false`. This means:

- First-time visitor hits `/` → blank "Loading..." screen while Convex WebSocket connects
- If Convex is slow to respond (cold start, network latency), the landing page is invisible for 2-5+ seconds
- The landing page has **zero Convex dependencies** — it's pure marketing HTML. It should never wait on a backend connection.

**B. Showcase images are 8MB each.**

```
dog.png   — 8,024,155 bytes (7.7 MB)
tank.png  — 8,595,460 bytes (8.2 MB)
```

That's **~16MB of images** loaded in the hero section. These are unoptimized, full-resolution sprite sheet files. Even on a fast connection, this adds seconds of load time and massive bandwidth waste.

---

### 2. Conflicting Calls to Action

The page has **four separate "Get Started" / sign-up CTAs** competing for attention:

| Location | CTA Text | Link |
|---|---|---|
| Nav bar (top-right) | "Get Started" | `/sign-up` |
| Hero section | "Start Generating" | `/sign-up` |
| Pricing card | "Get Started" | `/sign-up` |
| Final CTA section | "Get Started →" | `/sign-up` |

Plus a 5th link: "Sign In" in the nav, and a 6th: "Learn more" anchor link in the hero.

**The problem isn't that CTAs exist in multiple places — that's normal for a landing page. The problem is:**

1. **Three different button labels** ("Get Started", "Start Generating", "Get Started →") for the same action — inconsistent language, unclear which is the primary
2. **The pricing section has its own CTA** before the user has seen any proof of quality — the showcase is above it, but the pricing CTA competes with the hero CTA before the user has scrolled through the value proposition
3. **"Learn more" anchor link** in the hero dilutes the primary action — if the hero's job is to convert, offering an escape hatch weakens it
4. **The final CTA section** ("Ready to see the difference?") is a full-width centered block that breaks the editorial left-aligned layout established everywhere else — it reads as a different site

**Prescription:** One primary CTA label used everywhere. Remove the "Learn more" escape hatch from the hero. The final CTA section should be tighter and left-aligned to match the page rhythm.

---

### 3. Showcase Images Are Not Transparent

**This is the most damaging issue.** The entire product promise is native transparent-background generation. The hero showcase lets users switch backgrounds to "prove" transparency. But:

- **`dog.png`**: A pixel art sprite sheet of a Corgi character with a **baked-in checkerboard pattern** (the checkerboard is flattened into the pixel data). It's a mockup of what a transparent image *would look like*, not an actual transparent image. When displayed on the Emerald gradient background, the fake checkerboard will be visible — immediately exposing the lie.

- **`tank.png`**: A sprite sheet of a futuristic tank ("ATLAS-1") on a **solid dark teal background with grid lines**. Not transparent at all. Switching backgrounds in the showcase will show a teal rectangle sitting on top of whatever background is selected.

**Neither image is a single subject on a transparent background.** They're both multi-frame sprite sheets with opaque backgrounds — the opposite of what we're selling.

The background switcher in `HeroShowcase.svelte` is supposed to be the "proof" moment — "look, the subject sits cleanly on any background." With these images, it proves the opposite.

---

## Implementation Plan

### Fix 1: Decouple Auth from Landing Page

**Strategy:** Move the Convex + auth setup out of the root layout and into the `/app` layout where it's actually needed. The landing page should render instantly with zero backend dependencies.

**Files to change:**

- `src/routes/+layout.svelte` — Strip `setupConvex`, `setupConvexAuth`, and the `isLoading` gate. This becomes a pure shell: imports `app.css`, renders `children`.
- `src/routes/+page.svelte` — No changes needed (already has no backend deps).
- `src/routes/app/+layout.svelte` — Already has its own layout. Move `setupConvex(PUBLIC_CONVEX_URL)` and `setupConvexAuth()` here. Keep the `isLoading` gate here where it belongs (protecting authenticated routes).
- Auth callback route — The OAuth callback lands on the root `/` with `?code=`. We need to handle this. Options:
  - **(A)** Add a dedicated `/auth/callback` route that handles the code exchange and redirects to `/app`. Configure Google OAuth redirect URI accordingly.
  - **(B)** Keep a lightweight code-detection check in the root layout that only activates when `?code` is present — no Convex setup on normal visits.
  
  **Decision: Option B** — minimal disruption, no OAuth reconfiguration needed. The root layout checks for `?code` synchronously; if absent, renders children immediately with no Convex overhead. If present, shows a minimal loading state while exchanging the code, then redirects.

**Expected impact:** Landing page goes from 2-5s load to <200ms (just HTML + CSS + images).

### Fix 2: Replace Showcase Images with Real Transparent Assets

**Strategy:** Use our own generation pipeline to produce two showcase images that are *actually transparent*. These should be single subjects (not sprite sheets) that look compelling on every background option in the switcher.

**Subjects to generate:**
1. A subject that shows off soft semi-transparent edges (fur, glow, wisps) — this is our differentiator
2. A subject that shows off clean hard edges (logo, icon, product shot) — this is the common use case

**Process:**
1. Use the Celstate generation pipeline (Gemini dual-pass → difference matte) to generate both images
2. Manually verify the alpha channel quality
3. Optimize file sizes: target <500KB each (resize to showcase dimensions, run through PNG optimization)
4. Replace `static/images/dog.png` and `static/images/tank.png`
5. Update `HeroShowcase.svelte` labels and alt text to match the new subjects

**Until pipeline-generated assets are ready,** we can use any two high-quality transparent PNGs as temporaries — but they must be *actually transparent*, not mockups with baked-in checkerboard.

**Image optimization regardless of source:**
- Resize to display dimensions (the showcase is ~600px wide at most — no need for source images larger than 1200px)
- Run through `pngquant` or equivalent for lossless/near-lossless compression
- Target: <500KB per image (down from 8MB)

### Fix 3: Consolidate CTAs

**Strategy:** One primary label, one primary style, used consistently. Remove dilutive secondary actions from the hero.

**Changes:**

| Location | Current | After |
|---|---|---|
| Nav bar | "Get Started" (accent button) | "Start Generating" (accent button) — matches hero |
| Hero | "Start Generating" + "Learn more" | "Start Generating" only — remove "Learn more" |
| Pricing card | "Get Started" (accent button) | "Start Generating" (accent button) — matches hero |
| Final CTA section | Centered block with "Get Started →" | **Remove entirely.** The pricing section is the final CTA. The footer follows directly. |

**Rationale for removing the final CTA section:**
- It's a centered layout that breaks the editorial left-aligned design language
- It says nothing the pricing section doesn't already say
- Radial glow background effect is the only "different site" moment — it breaks visual consistency
- Every section should earn its place; this one doesn't

**Net result:** Two CTA touchpoints (hero + pricing) with identical language ("Start Generating"), both linking to `/sign-up`. Nav has a matching button for persistent access. Clean, no confusion.

---

## Execution Order

1. **Fix 1: Auth decoupling** — highest impact, unblocks everything (the page is literally unusable while it waits on Convex)
2. **Fix 3: CTA consolidation** — quick, pure markup changes
3. **Fix 2: Image replacement** — depends on pipeline or manual asset creation, can be done in parallel

## Verification

After all three fixes:
- `http://localhost:5173/` renders in <500ms with no backend calls
- Page has exactly 2 CTA buttons (hero + pricing) with consistent "Start Generating" label  
- Nav has "Start Generating" button + "Sign In" link
- Hero showcase images are actually transparent, display correctly on all 5 background options
- Total image payload < 1MB (down from 16MB)
- OAuth callback flow still works end-to-end (sign in → Google → callback → `/app`)
- Authenticated `/app` routes still gate on auth loading state
