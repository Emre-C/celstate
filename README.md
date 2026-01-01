# Celstate

This API is designed for autonomous AI agents to request and retrieve transparent UI assets (PNG/WEBP/Animated WEBP).

## Core Concepts

1. **Jobs**: Generation is asynchronous. Create a job, poll for status, and download results.
2. **Transparent Backgrounds**: 
   - **Images**: Use "Difference Matting" (Dual-pass white/black) for perfect semi-transparency (glass, shadows).
   - **Videos**: Use Chroma Key (Neon Green) for animated WebP loops.
3. **Storage**: Assets are stored locally in `var/jobs/{job_id}/outputs` during generation.
4. **Archiving**: Successful assets are automatically promoted to a permanent, organized gallery in `assets/archive/{job_id_prefix}_{name}/`.

## Endpoints

### 1. Create Asset Job
`POST /v1/assets`

**Request Body:**
```json
{
  "type": "image",  // or "video"
  "prompt": "A glowing crystal potion bottle with smoke inside",
  "name": "crystal_potion", // optional
  "aspect_ratio": "16:9", // optional, for video. "16:9" or "9:16". (1:1 is auto-corrected to 16:9)
  "animation_intent": "drift", // optional style hint
  "context_hint": "placed behind a 300x100 button" // optional placement hint
}
```

**Response (201 Created):**
```json
{
  "id": "uuid-v4-string",
  "status": "queued",
  "type": "image",
  "prompt": "...",
  "name": "crystal_potion",
  "created_at": "ISO-TIMESTAMP",
  "progress_stage": "initialized"
}
```

### 2. Get Job Status
`GET /v1/assets/{job_id}`

**Response:**
```json
{
  "id": "...",
  "status": "succeeded", // or "queued", "running", "failed"
  "progress_stage": "completed",
  "result_manifest": {
    "name": "crystal_potion",
    "variants": [
      {
        "scale": "@3x",
        "size": "1024x1024",
        "file": "/absolute/path/to/crystal_potion@3x.webp"
      },
      ...
    ],
    "telemetry": {
      "transparent": "45.2%",
      "center_transparency": "85.1%", // Higher means more transparent/free in the center
      "opaque": "10.5%"
    },
    "snippets": {
      "react_native": "// Copy-paste usage hint..."
    }
  }
}
```

### 3. Download Assets
Assets are served at `/assets/{job_id}/outputs/{filename}`.
Example: `https://celstate.onrender.com/assets/uuid/outputs/crystal_potion@3x.webp`

## Implementation for Agents

1. **Environment**: Ensure `GEMINI_API_KEY` is set.
2. **Start Server**: `uvicorn src.api.main:app --reload`
3. **Workflow**:
   - `POST /v1/assets` -> Store `id`.
   - Poll `GET /v1/assets/{id}` until `status == "succeeded"`.
   - Use `result_manifest` to find filenames and download from `/assets/...`.

## Local Debugging
Check `var/jobs/{id}/job.json` to see the current state of any job directly on disk.
Check `var/jobs/{id}/studio/` for raw intermediate passes (white/black/green).

## Setup with UV

This project uses [UV](https://github.com/astral-sh/uv) for fast Python package management.

### Prerequisites

- Install [UV](https://github.com/astral-sh/uv#installation)

### Quick Start

```bash
# Install dependencies
uv sync

# Run development server
uv run dev

# Run tests
uv run test

# Lint code
uv run lint

# Format code
uv run format
```

### Available Scripts

- `uv run dev` - Start development server with hot reload
- `uv run start` - Start production server
- `uv run test` - Run tests
- `uv run lint` - Run linting
- `uv run format` - Format code

## Project Structure

- `src/` - Source code
  - `src/api/` - FastAPI application
  - `src/engine/` - Media generation engine
    - `src/engine/core/` - Core production logic (generator, processor, job store, orchestrator)
    - `src/engine/experiments/` - Debug scripts and experimental code
  - `src/mcp_server.py` - MCP server for AI agents
- `var/` - Runtime data and jobs
  - `var/jobs/` - Active job storage
  - `var/debug_outputs/` - Debug and experimental outputs
- `assets/` - Generated media assets
  - `assets/archive/` - Permanent asset gallery
- `experiments/` - Experimental data and frame sequences
- `docs/` - Documentation
  - `docs/research/` - Technical research and implementation plans

## API

The API runs on `http://localhost:8000` by default.

- `POST /v1/assets` - Create new media asset
- `GET /v1/assets/{id}` - Get asset status
- `GET /assets/{id}/outputs/` - Access generated files

## Development

This project uses Python 3.12+ and follows the Agent-First architecture pattern.

## MCP Server

This API is also exposed as an **MCP (Model Context Protocol)** server, allowing AI agents (like Claude) to directly connect and use the tools.

- **Deployment URL:** `https://celstate.onrender.com`
- **MCP Endpoint:** `https://celstate.onrender.com/sse`

### Tools Available via MCP

- `generate_asset(prompt, type, name, aspect_ratio, animation_intent, context_hint)`: Creates a generation job.
  - **Implicit Constraint Handling**: If you request `1:1` for a video, the server auto-corrects to `16:9` to prevent model failure.
- `get_asset(job_id)`: Checks status and returns manifest with asset URLs, telemetry (including spatial analysis), and integration snippets.

### Connecting

Use an MCP client (e.g., in Claude Desktop or via the MCP Inspector) to connect to `https://celstate.onrender.com/sse`.

---

## Development Roadmap

### Current Sprint: Debug Tooling & Transparency Fix
- [ ] **P0**: Fix video transparency (chroma key → alpha WebP)
- [ ] Local debug CLI (`scripts/debug_pipeline.py`) for cost-free experimentation
- [ ] Debug utilities in `src/engine/debug.py` for pipeline testing
- [ ] Add debug mode to processor that saves intermediate outputs

### Next Sprint: DX Improvements
- [ ] Preview thumbnails during generation
- [ ] `primitiveColors` injection for brand color matching
- [ ] Predefined ratios (`1:1-button`, `hero-16x9`)

### Future: Archetype System
- [ ] ButtonActor template (idle → pressed → released)
- [ ] LoaderActor template (progress states)
- [ ] ToastActor template (enter/exit transitions)
- [ ] Manifest v0 JSON schema validation

---

## Known Issues

### Video Transparency (Under Investigation)
Video assets generated via chroma key may have broken transparency. The FFmpeg pipeline requires explicit alpha pixel format (`-pix_fmt yuva420p`) to preserve transparency in WebP output.

**Workaround**: Use `type: "image"` for static assets (difference matting works correctly).

**Status**: Fix in progress.

---

## Technical Research: Dual-Pass Video Difference Matting

Through architectural archaeology and experimentation, we have identified a path to bring "Difference Matting" (perfect alpha for glass/smoke/shadows) to video assets, which were previously limited to lossy Chroma Keying.

### The "Impossible" Problem
Standard generative video models (like Veo 3.1) do not guarantee identical motion across two different generations. This makes dual-pass Difference Matting (generating on white, then black) effectively impossible without frame-accurate motion alignment.

### The Veo 3.1 Breakthrough: First/Last Frame Interpolation
Veo 3.1 supports a **First and Last Frame** parameter. By passing the *exact same* anchor frame as both the start and end of the video, we can force the model to create a seamless loop.

**The Workflow:**
1.  **Anchor Pass**: Generate a subject on WHITE background (Nano Banana).
2.  **Edit Pass**: Edit that subject to be on BLACK background while maintaining identical subject pose/lighting.
3.  **Video Pass (White)**: Generate a video with `image=white_anchor` and `last_frame=white_anchor`.
4.  **Video Pass (Black)**: Generate a video with `image=black_anchor` and `last_frame=black_anchor`.

### Critical API Knowledge (The "Files API" Rule)
When using `last_frame` or `reference_images` in the Gemini API, you **cannot** pass in-memory image objects directly. This will result in a `400 INVALID_ARGUMENT` error.

**The Solution:**
You must use the **Gemini Files API** to upload the image first, then pass the file reference to the video generation call.

```python
# Correct pattern for video interpolation
uploaded_file = client.files.upload(file=image_bytes, mime_type="image/png")

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt=loop_prompt,
    image=uploaded_file,
    config=types.GenerateVideosConfig(
        last_frame=uploaded_file
    )
)
```

### Status of Experimentation
-   **Approach identified**: Looping First/Last Frame interpolation.
-   **Constraints found**: File API upload is mandatory for multi-frame prompts.
-   **Next steps**: Verify motion alignment correlation between the white and black passes to ensure pixel-perfect subtraction is possible.

---

## Technical Roadmap & Experiment Design

### 1. Proposed Experiment Approaches

| Approach | Method | Risk/Reward |
|----------|--------|-------------|
| **1. Looping First/Last Frame** | Start/End frames are identical (same subject/pose/color). Force a loop twice (white/black). | **High Reward**: Seamless loops with aligned motion. |
| **2. Subject Reference** | Use `reference_images` to lock subject identity, then swap background colors. | **Medium Risk**: Motion paths may still differ. |
| **3. Video Extension** | Generate on white, then attempt to replicate extension on black. | **High Risk**: Stochastic drift is likely. |
| **4. Hybrid Fallback** | Use Chroma Key for motion, but use Difference Matting for static keyframes. | **Safe**: Guaranteed ship, but lossy transparency in motion. |

### 2. Success Criteria
For dual-pass video Difference Matting to be viable, the generated pairs must meet:
- **Frame registration error**: < 5 pixels RMS
- **Motion vector alignment**: > 95% correlation
- **Resulting alpha quality**: No visible halos or "shimmer" on composite.

### 3. Research Roadmap (AI Researcher)
We are tasking our AI researcher with investigating the following "single-pass" alternatives:
1. **Temporal Alpha Matting**: Techniques to extract alpha from a single video without needing dual-pass (e.g., Background Matting V2).
2. **MODNet / Robust Video Matting (RVM)**: ML-based approaches that extract better alpha from green screen than standard FFmpeg filters.
3. **Neural Radiance Fields (NeRF) for Transparency**: Reconstructing partial transparency (glass/smoke) from neural video decompositions.
4. **Diffusion Consistency**: Researching methods to make video generation models more deterministic/reproducible across different background prompts.

---

## Status of Execution
- [x] **Archeology**: Identified `last_frame` interpolation as the key breakthrough.
- [x] **API Verification**: Identified Files API requirement to resolve `INVALID_ARGUMENT`.
- [ ] **Phase 1**: Run looping first/last frame experiment.
- [ ] **Phase 2**: Quantitative analysis of motion correlation.
- [ ] **Phase 3**: Integration into `MediaProcessor`.

---

