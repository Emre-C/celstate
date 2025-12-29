"""
MCP Server for Celstate AI Media API.

This server exposes tools for AI agents to generate and retrieve transparent
UI assets (PNG/WEBP/Animated WEBP) via the Model Context Protocol.
"""

import threading
from pathlib import Path
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
load_dotenv()

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

from src.engine.generator import MediaGenerator
from src.engine.processor import MediaProcessor
from src.engine.job_store import JobStore
from src.engine.orchestrator import Orchestrator

# --- Pydantic Models (Inline, matching src/api/main.py) ---

class ComponentManifest(BaseModel):
    version: str
    id: str
    type: str
    intrinsics: Dict[str, Any]
    states: Dict[str, Any]
    transitions: List[Any]
    accessibility: Dict[str, Any]

class ComponentData(BaseModel):
    manifest: ComponentManifest
    assets: Dict[str, Optional[str]]
    telemetry: Optional[Dict[str, Any]] = None

class JobResponse(BaseModel):
    id: str
    status: str
    type: str
    prompt: str
    name: str
    created_at: str
    progress_stage: str
    component: Optional[ComponentData] = None
    error: Optional[str] = None

# --- Setup ---

BASE_DIR = Path(__file__).resolve().parent.parent
JOB_STORE_DIR = BASE_DIR / "var" / "jobs"

job_store = JobStore(JOB_STORE_DIR)
generator = MediaGenerator()
processor = MediaProcessor()
orchestrator = Orchestrator(job_store, generator, processor)

mcp = FastMCP("Celstate AI Media")

# Note: Static file serving will be handled by adding a custom route
# We'll add a Starlette route for /assets
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

# Add static files route via custom_route decorator is not suitable.
# We'll serve assets differently - the sse_app doesn't support mounting.
# For now, assets will need to be served via a separate endpoint or the existing API.
# In production, Render can serve static files or we use the main API for assets.

# --- Internal Helpers ---

def _resolve_asset_urls(job: dict, base_url: str) -> dict:
    """Populate component asset URLs. Inline for AI maintainability."""
    if job.get("status") != "succeeded":
        return job

    component = job.get("component")
    if not component:
        return job

    resolved_assets = {}
    for filename in component.get("assets", {}).keys():
        resolved_assets[filename] = f"{base_url}/assets/{job['id']}/outputs/{filename}"

    job["component"]["assets"] = resolved_assets
    return job

def _run_job_background(job_id: str):
    """Run orchestrator.run_job in a separate thread."""
    orchestrator.run_job(job_id)

# --- MCP Tools ---

@mcp.tool()
def generate_asset(prompt: str, type: str = "image", name: Optional[str] = None) -> dict:
    """
    Generates a UI asset (image or video with transparent background).

    Args:
        prompt: Description of the asset to generate (e.g., "A glowing crystal potion bottle").
        type: Either "image" (for static WebP) or "video" (for animated WebP). Defaults to "image".
        name: Optional name for the asset (will be snake_cased). If omitted, derived from prompt.

    Returns:
        A JobResponse dict with 'id' and 'status'. Poll get_asset(id) until status is 'succeeded'.

    Example:
        job = generate_asset("A nervous glowing button", type="image", name="nervous_button")
        # job["id"] -> "uuid-v4-string"
        # job["status"] -> "queued" or "running"
    """
    if type not in ["image", "video"]:
        return {"error": "Type must be 'image' or 'video'"}

    job = job_store.create_job(type, prompt, name)
    
    # Run job in background thread
    thread = threading.Thread(target=_run_job_background, args=(job["id"],))
    thread.start()

    return job

@mcp.tool()
def get_asset(job_id: str) -> dict:
    """
    Gets the status of an asset generation job.

    Args:
        job_id: The UUID of the job returned by generate_asset.

    Returns:
        A JobResponse dict. If status is 'succeeded', the 'component' field contains:
        - manifest: Full component manifest (version, intrinsics, states, transitions, accessibility)
        - assets: Dict of filename -> full URL (ready to download)
        - telemetry: Generation metrics

    Example (succeeded):
        job = get_asset("uuid-v4-string")
        # job["status"] -> "succeeded"
        # job["component"]["assets"] -> {"button@3x.webp": "http://host/assets/uuid/outputs/button@3x.webp"}
    """
    job = job_store.get_job(job_id)
    if not job:
        return {"error": f"Job {job_id} not found"}

    # Resolve URLs for AI agent consumption
    # Note: For MCP, we use a placeholder base_url that will be replaced by the actual deployment URL
    # In production on Render, this will be the public URL
    base_url = "http://localhost:8000"  # Will be replaced by actual host in production
    job = _resolve_asset_urls(job, base_url)

    return job

# --- Expose Starlette app for uvicorn ---

# Use sse_app for SSE transport (required for remote MCP connections)
app = mcp.sse_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
