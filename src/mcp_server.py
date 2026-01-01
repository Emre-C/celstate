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

from src.engine.core.generator import MediaGenerator
from src.engine.core.processor import MediaProcessor
from src.engine.core.job_store import JobStore
from src.engine.core.orchestrator import Orchestrator

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

# --- Local Asset Server ---

import os
import http.server
import socketserver

ASSET_SERVER_PORT = int(os.getenv("ASSET_SERVER_PORT", 8081))
IS_RENDER = os.getenv("RENDER") == "true"

def start_local_asset_server(directory: Path, port: int):
    """
    Starts a simple HTTP server to serve assets locally.
    This runs in a daemon thread so it dies when the main process dies.
    """
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

    # Allow address reuse to prevent "Address already in use" errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", port), Handler) as httpd:
        print(f"Local asset server running on port {port} serving {directory}")
        httpd.serve_forever()

if not IS_RENDER:
    # Ensure the directory exists
    output_dir = JOB_STORE_DIR # /var/jobs
    # Actually, the file path structure is /var/jobs/<id>/outputs/...
    # But resolution logic is /assets/<id>/outputs/...
    # If we serve JOB_STORE_DIR at root, then:
    # http://localhost:8081/<id>/outputs/... matches the structure if we map /assets/ -> /
    # So we need to be careful about the path mapping.
    # The resolution logic below expects: {base_url}/assets/{job['id']}/outputs/{filename}
    # If base_url is localhost:8081, then URL is localhost:8081/assets/...
    # Use a custom handler or simpler: just serve BASE_DIR and adjust path?
    # Or just serve JOB_STORE_DIR and change the resolution URL structure for local?
    
    # Simpler: Modify resolution to NOT include /assets/ prefix for local, or alias it.
    # Let's serve JOB_STORE_DIR.
    # URL: http://localhost:8081/<job_id>/outputs/<filename>
    # We will adjust _resolve_asset_urls to handle this difference.
    
    # Create directory if it doesn't exist to prevent server launch error
    JOB_STORE_DIR.mkdir(parents=True, exist_ok=True)
    
    server_thread = threading.Thread(
        target=start_local_asset_server, 
        args=(JOB_STORE_DIR, ASSET_SERVER_PORT),
        daemon=True
    )
    server_thread.start()


# --- Internal Helpers ---

def _resolve_asset_urls(job: dict) -> dict:
    """Populate component asset URLs. Inline for AI maintainability."""
    if job.get("status") != "succeeded":
        return job

    component = job.get("component")
    if not component:
        return job

    resolved_assets = {}
    
    if IS_RENDER:
        base_url = "https://celstate.onrender.com"
        # Render URL structure: /assets/<id>/outputs/<filename>
        # Implies there's a route /assets that maps to the job store.
        url_pattern = f"{base_url}/assets/{{job_id}}/outputs/{{filename}}"
    else:
        base_url = f"http://localhost:{ASSET_SERVER_PORT}"
        # Local SimpleHTTPRequestHandler serving JOB_STORE_DIR directly.
        # Structure in disk: JOB_STORE_DIR/<id>/outputs/<filename>
        # So URL should be: http://localhost:8081/<id>/outputs/<filename>
        url_pattern = f"{base_url}/{{job_id}}/outputs/{{filename}}"

    for filename in component.get("assets", {}).keys():
        resolved_assets[filename] = url_pattern.format(
            job_id=job['id'], 
            filename=filename
        )

    job["component"]["assets"] = resolved_assets
    return job

def _run_job_background(job_id: str):
    """Run orchestrator.run_job in a separate thread."""
    orchestrator.run_job(job_id)

# --- MCP Tools ---

@mcp.tool()
def generate_asset(
    prompt: str, 
    type: str = "image", 
    name: Optional[str] = None,
    aspect_ratio: str = "16:9",
    animation_intent: Optional[str] = None,
    context_hint: Optional[str] = None
) -> dict:
    """
    Generates a UI asset (image or video with transparent background).

    Args:
        prompt: Description of the asset (e.g., "A glowing potion bottle").
        type: "image" or "video". Defaults to "image".
        name: Optional name.
        aspect_ratio: For video only. "16:9" (landscape) or "9:16" (portrait). Defaults to "16:9". "1:1" is NOT supported and will be auto-corrected.
        animation_intent: Optional style hint (e.g., "drift", "pulse", "spin").
        context_hint: Optional placement hint (e.g., "header background", "behind button").

    Returns:
        A JobResponse dict with 'id' and 'status'.
    """
    if type not in ["image", "video"]:
        return {"error": "Type must be 'image' or 'video'"}

    job = job_store.create_job(
        asset_type=type, 
        prompt=prompt, 
        name=name,
        aspect_ratio=aspect_ratio,
        animation_intent=animation_intent,
        context_hint=context_hint
    )
    
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
    job = _resolve_asset_urls(job)

    return job

# --- Expose Starlette app for uvicorn ---

# Use sse_app for SSE transport (required for remote MCP connections)
app = mcp.sse_app()

if __name__ == "__main__":
    # Run with stdio transport for local Cursor/client usage
    # For production (Render), use 'uvicorn src.mcp_server:app --host 0.0.0.0 --port 8000'
    mcp.run()
