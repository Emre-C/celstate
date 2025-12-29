# Celstate

This API is designed for autonomous AI agents to request and retrieve transparent UI assets (PNG/WEBP/Animated WEBP).

## Core Concepts

1. **Jobs**: Generation is asynchronous. Create a job, poll for status, and download results.
2. **Transparent Backgrounds**: 
   - **Images**: Use "Difference Matting" (Dual-pass white/black) for perfect semi-transparency (glass, shadows).
   - **Videos**: Use Chroma Key (Neon Green) for animated WebP loops.
3. **Storage**: Assets are stored locally in `var/jobs/{job_id}/outputs`.

## Endpoints

### 1. Create Asset Job
`POST /v1/assets`

**Request Body:**
```json
{
  "type": "image",  // or "video"
  "prompt": "A glowing crystal potion bottle with smoke inside",
  "name": "crystal_potion" // optional, sanitized to snake_case
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
      ...
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
- `src/engine/` - Core media generation logic
- `var/` - Runtime data and jobs
- `assets/` - Generated media assets

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

- `generate_asset(prompt, type, name)`: Creates a generation job.
- `get_asset(job_id)`: Checks status and returns manifest with asset URLs appropriately.

### Connecting

Use an MCP client (e.g., in Claude Desktop or via the MCP Inspector) to connect to `https://celstate.onrender.com/sse`.

