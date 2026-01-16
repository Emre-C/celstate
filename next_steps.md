## Progress Summary

### Current Architecture Analysis

**CLI vs Orchestrator Relationship:**
- The CLI ([src/celstate/cli/main.py](cci:7://file:///Users/emre/Documents/codebase/active-projects/celstate/src/celstate/cli/main.py:0:0-0:0)) **directly orchestrates** the generation pipeline without using the `Orchestrator` class
- CLI imports and instantiates `MediaGenerator`, `MediaProcessor` directly in the `generate` command
- `Orchestrator` class exists but is **unused by the CLI** - only used in test scripts and experiments

**Redundancy Identified:**
- CLI implements the same 3-stage pipeline as Orchestrator:
  1. `MediaGenerator.generate_image_pair()` - Creates white/black passes
  2. `MediaProcessor.process_image()` - Difference matting with transparency extraction
  3. `LayoutAnalyzer` validation (for containers) - Quality verification

**Key Differences:**
- **CLI**: Simplified, synchronous execution, minimal logging, returns JSON to stdout
- **Orchestrator**: Enhanced with detailed tracing via `Tracer` class, job state management, progress stages, comprehensive error handling

### Critical Findings

**Missing Features in CLI:**
1. **No `render_size_hint` support** - CLI doesn't pass this optimization parameter to generator
2. **No `style_context` parameter** - CLI ignores style context entirely
3. **No comprehensive tracing** - Missing the detailed observability that your infrastructure needs
4. **No container quality verification** - CLI skips the `LayoutAnalyzer.verify_container_hole()` check

**Interpreter Parameter Mismatch:**
- CLI calls `generator.generate_image_pair(prompt, name, studio_dir)` 
- Generator expects: `(prompt, name, studio_dir, tracer=None)`
- But CLI doesn't pass the missing `style_context` and `render_size_hint` parameters that Orchestrator supports

### Decisions Made

**Recommendation: Use Orchestrator as Canonical Interface**
- The CLI should delegate to `Orchestrator.run_job()` instead of duplicating pipeline logic
- This eliminates redundancy and ensures consistent behavior across all interfaces
- Preserves all tracing and quality verification features your infrastructure needs

**Keep CLI as Thin Wrapper:**
- CLI remains the AI-agent interface but orchestrates via `Orchestrator`
- Maintains simple JSON input/output contract for agents
- Leverages `JobStore` for persistence and traceability

### Next Steps

1. **Refactor CLI to use Orchestrator:**
   - Replace direct generator/processor calls with `orchestrator.run_job()`
   - Update CLI to create jobs via `JobStore.create_job()` with all parameters
   - Add missing `style_context` and `render_size_hint` support

2. **Fix Generator Interface:**
   - Update `MediaGenerator.generate_image_pair()` signature to match CLI usage
   - Ensure `style_context` and `render_size_hint` parameters are properly handled

3. **Verify Tracing Integration:**
   - Ensure CLI outputs job results while preserving full trace data in jobs directory
   - Test that all observability data is captured for your infrastructure needs

4. **Update Tests:**
   - Modify CLI tests to verify Orchestrator integration
   - Ensure all pipeline stages work correctly through the new architecture

**Result:** Single source of truth for generation pipeline, full observability for your infrastructure, clean AI-agent interface via CLI.

---

## Deployment Next Steps (Cloudflare Pages → Convex → Namecheap)

### 1) Cloudflare Pages: Host the landing + app bundle
**Goal:** Serve `dist/landing/` at `/landing/` and `dist/app/` at `/app/`.

1. Create a **Cloudflare Pages** project for this repo.
2. Build command (example):
   ```bash
   npm --prefix web install
   npm --prefix web run build
   node scripts/build_static.mjs
   ```
3. Build output directory: `dist` (the script assembles `/landing/` + `/app/`).
4. Add environment variables in Cloudflare Pages (build time):
   - `VITE_CONVEX_URL` (frontend build time)

### 2) Convex: Production auth config
**Goal:** Make OAuth callbacks + JWTs work on the production domain.

1. In Convex **production** deployment, set:
   - `SITE_URL=https://<your-domain>`
   - `JWT_PRIVATE_KEY` + `JWKS`
   - `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`
   - `SERVICE_KEY`
2. In Google Cloud Console:
   - Authorized JS origin: `https://<your-domain>`
   - Redirect URI: `https://<your-deployment>.convex.site/api/auth/callback/google`

### 3) Namecheap: Point custom domain to Cloudflare Pages
**Goal:** `https://<your-domain>` resolves to the Cloudflare Pages site.

1. In Cloudflare Pages, add a **Custom Domain** (e.g., `www.yourdomain.com`).
2. Cloudflare will provide DNS records. In Namecheap DNS settings:
   - For subdomain (recommended):
     - CNAME `www` → `<project>.pages.dev`
   - For root domain:
     - Use Namecheap URL redirect to `https://www.yourdomain.com`, or
     - Move DNS to Cloudflare if you want apex `@` directly.
3. Wait for DNS propagation, then HTTPS will auto-provision on Cloudflare Pages.

### 4) Final verification
1. Visit `https://<your-domain>/app/` and sign in via Google OAuth.
2. Confirm sign-out works.
3. Confirm auth tables populate in Convex production data viewer.