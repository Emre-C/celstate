# Celstate

**Smart Asset Infrastructure for AI Agents** — MCP server providing "Layout-Ready Assets" (pixels + logic) for implementing "Software Whimsy".

## Vision

AI Coding Agents are currently "Visually Illiterate." If an Agent generates a decorative frame with a transparent hole, it doesn't know where the hole is. This tool solves that by returning JSON with Image URLs **and** precise layout measurements (insets, bounding boxes, masking data).

See [docs/VISION.md](docs/VISION.md) for the full product vision.

## Core Concepts

1. **Jobs**: Generation is asynchronous. Create a job, poll for status, retrieve the "Smart Asset" response.
2. **Transparent Backgrounds**: 
   - **Images**: "Difference Matting" (dual-pass white/black) for perfect semi-transparency.
   - **Videos**: Chroma key (green screen) processing.
3. **Smart Metadata**: CV-based analysis returns `content_zones`, `slice_insets`, `shape_hint`, and mask companions.
4. **Storage**: Assets stored in `var/jobs/{job_id}/outputs` during generation, archived to `assets/archive/`.

## Quick Start

### Prerequisites

- Python 3.12+
- [UV](https://github.com/astral-sh/uv) package manager
- Environment variables:
  - `VERTEX_API_KEY`
  - `VERTEX_PROJECT_ID`
  - `VERTEX_LOCATION`

### Installation

```bash
# Install dependencies
uv sync

# Run MCP server (local stdio mode)
uv run python src/mcp_server.py

# Run MCP server (SSE mode for remote agents)
uvicorn src.mcp_server:app --host 0.0.0.0 --port 8000
```

## MCP Interface

This is an **MCP-first** project. The primary interface is the Model Context Protocol server.

### Deployment

- **Production URL:** `https://celstate.onrender.com`
- **MCP Endpoint:** `https://celstate.onrender.com/sse`

### Tools

#### `generate_asset`

Creates a UI asset generation job.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Description of the asset |
| `type` | string | `"image"` or `"video"` |
| `name` | string? | Optional human-readable name |
| `aspect_ratio` | string? | For video: `"16:9"` or `"9:16"` (1:1 auto-corrects) |
| `animation_intent` | string? | Style hint (e.g., `"drift"`, `"pulse"`) |
| `context_hint` | string? | Placement context (e.g., `"behind a button"`) |

**Returns:** Job object with `id` and `status`.

#### `get_asset`

Retrieves job status and the "Smart Asset" response.

| Parameter | Type | Description |
|-----------|------|-------------|
| `job_id` | string | UUID from `generate_asset` |

**Returns:** Job object. When `status == "succeeded"`, includes:
- `component.manifest` — Full component manifest with intrinsics
- `component.assets` — Dict of filename → download URL
- `component.telemetry` — Generation metrics and spatial analysis

### Connecting

Use an MCP client to connect:
- **Cursor/Claude Desktop (local)**: Run `python src/mcp_server.py` (stdio)
- **Remote agents**: Connect to `https://celstate.onrender.com/sse`

## Project Structure

```
src/
├── mcp_server.py           # MCP server (primary interface)
└── engine/
    └── core/
        ├── generator.py     # Gemini/Vertex image & video generation
        ├── processor.py     # Difference matting & chromakey
        ├── orchestrator.py  # Job lifecycle management
        ├── job_store.py     # JSON job persistence
        └── archiver.py      # Asset archiving
var/
├── jobs/                   # Active job storage
docs/
├── VISION.md               # Product vision
assets/
├── archive/                # Permanent asset gallery
```

## Local Debugging

```bash
# Check job state directly on disk
cat var/jobs/{job_id}/job.json

# View intermediate generation passes
ls var/jobs/{job_id}/studio/
```

## Development

```bash
# Lint
uv run lint

# Format
uv run format

# Test
uv run test
```

---
