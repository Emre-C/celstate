"""
MCP Server for Celstate AI Media API.

This server exposes tools for AI agents to generate and retrieve transparent
UI assets (PNG) via the Model Context Protocol.
"""

import shutil
import threading
from pathlib import Path
from typing import Optional, Dict, Any, List, Annotated

from dotenv import load_dotenv
load_dotenv()

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

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
    snippets: Optional[Dict[str, str]] = None

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
    retry_after: Optional[int] = None
    estimated_duration_seconds: Optional[int] = None

# --- Setup ---

BASE_DIR = Path(__file__).resolve().parent.parent
JOB_STORE_DIR = BASE_DIR / "jobs"

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

import sys

def start_local_asset_server(directory: Path, port: int):
    """
    Starts a simple HTTP server to serve assets locally.
    This runs in a daemon thread so it dies when the main process dies.
    """
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)
        
        # Suppress logging to stdout/stderr unless necessary
        def log_message(self, format, *args):
            pass

    # Allow address reuse to prevent "Address already in use" errors on restart
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", port), Handler) as httpd:
        # MCPServer runs on stdio, so we MUST NOT print to stdout.
        # Use stderr for logs.
        print(f"Local asset server running on port {port} serving {directory}", file=sys.stderr)
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

# Estimated durations for each stage (seconds)
# Used to give agents a reliable polling timer
ESTIMATED_STAGE_DURATIONS = {
    "interpreting": 2,
    "generating": 15,
    "processing": 1,
    "analyzing_layout": 1
}
TOTAL_ESTIMATED_DURATION = sum(ESTIMATED_STAGE_DURATIONS.values())

@mcp.tool()
def generate_asset(
    prompt: Annotated[str, Field(description="The subject and shape description", max_length=2000)],
    asset_type: Annotated[str, Field(description="Type of asset: 'container', 'icon', or 'texture'")],
    style_context: Annotated[str, Field(description="Creative art style direction", max_length=2000)],
    layout_intent: Annotated[str, Field(description="Optional layout preference: 'row', 'column', 'grid', or 'auto'", default="auto")],
    render_size_hint: Annotated[Optional[int], Field(description="OPTICAL SIZING HINT: Approximate target pixel width. Controls detail level.", default=None)]
) -> dict:
    """
    Generates a Smart UI Component with layout metadata (insets, masks).
    
    Use this tool to create "Living" UI elements that need to interact with code 
    (e.g., text overlays, avatar layering) without manual pixel-pushing.

    Args:
        prompt: THE SUBJECT AND SHAPE ONLY. Do not describe art style here.
               Example: "A pill-shaped container for avatar", "A wide button".
               The Creative Interpreter will expand this into a rich visual description.
        
        asset_type: The category of UI component. MUST be one of:
            - "container": guaranteed TRANSPARENT CENTER. Returns `content_zones` 
                          (padding values) to perfectly position internal text/avatars.
            - "icon": A standalone symbol.
            - "texture": A seamless background.
            
        style_context: THE ART STYLE ONLY. Creative direction.
            Example: "Studio Ghibli anime style, warm, organic"
            Used by the interpreter to embellish the geometry with specific materials/lighting.
            
        layout_intent: Optional hint for how you intend to use the container.
            - "row": Horizontal layout (e.g., Avatar + Name)
            - "column": Vertical layout (e.g., Icon + Label)
            - "auto": Let the analyzer suggest the best layout based on the generated shape.
            
        render_size_hint: CRITICAL. Estimate the target pixel width based on your CSS/Layout.
            Example: If you are writing `w-12` (48px), pass `48`.
            - Small (< 128): We will force BOLD lines and STRONG silhouettes (no whisper-thin details).
            - Large (> 400): We will allow intricate details.
            Passed to the Creative Interpreter to control "Optical Sizing".
            
    Returns:
        Job ID. Use `get_asset(id)` to retrieve the asset and its
        `content_zones` metadata for layout.
        Includes `estimated_duration_seconds` to help set polling timers.
        
    Agent Hint:
        Separating `prompt` (Shape) from `style_context` (Art) is vital.
        - Prompt: "A pill shape" -> guarantees the code-compatible hole.
        - Style: "Vines" -> allows the frame to be wild/jagged without breaking the hole.
    """
    # 1. Immediate Runtime Validation (Defense in Depth)
    errors = []
    if len(prompt) > 2000:
        errors.append("prompt exceeds 2000 characters")
    if len(style_context) > 2000:
        errors.append("style_context exceeds 2000 characters")
    if asset_type not in ["container", "icon", "texture"]:
        errors.append("asset_type must be 'container', 'icon', or 'texture'")
        
    if errors:
        return {"error": "Validation Failed", "details": errors}

    job = job_store.create_job(
        asset_type=asset_type,
        prompt=prompt,
        style_context=style_context,
        layout_intent=layout_intent,
        render_size_hint=render_size_hint
    )
    
    # Run job in background thread
    thread = threading.Thread(target=_run_job_background, args=(job["id"],))
    thread.start()

    # Include estimated duration to help agents set polling timers (P2 user feedback)
    job["estimated_duration_seconds"] = TOTAL_ESTIMATED_DURATION
    return job

@mcp.tool()
def get_asset(job_id: str) -> dict:
    """
    Gets the status of an asset generation job.

    CRITICAL: ASSET URLS ARE DOWNLOAD LINKS
    
    The URLs returned in `component.assets` are download links served by the MCP.
    To use an asset in your project, you MUST:
    
    1. DOWNLOAD the asset using `curl` or `wget` to your local project directory.
    2. REFERENCE the downloaded local file in your UI code.
    
    Example Workflow:
        1. job = get_asset("uuid")
        2. url = job["component"]["assets"]["my-icon.png"]
        3. Run command: `curl -o /path/to/project/assets/icon.png {url}`
        4. In code: `<img src="/assets/icon.png" />`
    
    DO NOT hotlink to the MCP URL (localhost/celstate) in your production code.
    The MCP server is a build-time tool, not a production CDN.

    Args:
        job_id: The UUID of the job returned by generate_asset.

    Returns:
        A JobResponse dict. If status is 'succeeded', the 'component' field contains:
        - manifest: Component manifest containing:
            - `content_zones`: Padding insets (px + %). Includes `coordinate_system`
              field clarifying that vertical percentages are relative to image HEIGHT,
              horizontal percentages to image WIDTH.
            - `safe_zone`: {x, y, w, h} - Content-safe area
            - `layout_bounds`: {x, y, w, h} - Structural container bounds
            - `shape_hint`: Shape classification ("organic", "rounded_rectangle", etc.)
            - `mask_asset`: (ORGANIC SHAPES ONLY) Filename of clipping mask image
            - `snippets`: **Code to copy-paste**. Includes:
                - `css_absolute`, `tailwind_absolute`
                - `react_native_absolute`, `kotlin_compose`, `swift_uikit`
        - assets: Dict of filename -> download URL:
            - `{name}.png`: Primary transparent asset
            - `{name}_mask.png`: (ORGANIC ONLY) Clipping mask
            - `{name}_debug.png`: Debug overlay showing safe_zone (green) and 
              layout_bounds (red). Download this to visually verify positioning.
        - telemetry: Generation metrics
        
    UNDERSTANDING LAYOUT METRICS:
        We provide TWO layout metrics because generative assets are complex.
        
        1. safe_zone:
           - Contiguous empty pixels (via Largest Inscribed Rectangle algorithm).
           - Best for: GEOMETRIC assets with clean voids.
           - For ORGANIC/WHIMSICAL assets with scattered particles (fireflies, spores),
             this may fall back to layout_bounds. Check `safe_zone._fallback` field.
           
        2. layout_bounds:
           - Structural container area calculated from edge insets.
           - Tolerates scattered decorative particles in the aperture.
           - Best for: ORGANIC assets, or when safe_zone looks wrong.
           
        DECISION LOGIC FOR AGENTS:
        - "Geometric asset (rounded_rectangle, circle)": Use `safe_zone`.
        - "Organic asset (watercolor, whimsical)": Prefer `layout_bounds`.
        - "Unsure?": Download `{name}_debug.png` and check visually.
        - "safe_zone has `_fallback` key?": It fell back to layout_bounds because
          the LIR algorithm found an edge artifact instead of center void.
        
    UNDERSTANDING MASKS (for organic shapes):
        Masks are B&W images where WHITE = content-safe area, BLACK = frame.
        Use masks (`mask-image` or `MaskedView`) to clip content to the EXACT irregular shape.
        
    Workflow Example:
        1. job = get_asset("uuid")
        2. if job["status"] == "succeeded":
            manifest = job["component"]["manifest"]
            shape = manifest["intrinsics"]["shape_hint"]["type"]
            
            # Choose metric based on shape
            if shape == "organic":
                bounds = manifest["intrinsics"]["layout_bounds"]
            else:
                bounds = manifest["intrinsics"]["safe_zone"]
            
            # OPTION 1: Use raw measurements
            # style = { left: bounds["x"], top: bounds["y"], ... }
            
            # OPTION 2 (EASIER): Use generated snippets
            # css = manifest["snippets"]["tailwind_absolute"]
            # return <div className={css}>...</div>
    """
    job = job_store.get_job(job_id)
    if not job:
        return {"error": f"Job {job_id} not found"}

    # Resolve URLs for AI agent consumption
    job = _resolve_asset_urls(job)

    # Logic improvement for early polling:
    # If not finalized, ensure we return a clean 200 OK "processing" state
    # and guide the agent on when to retry.
    if job["status"] not in ["succeeded", "failed"]:
        job["status"] = "processing"
        job["retry_after"] = 10  # Tell agent to come back in 10s
        # Remove partial component data if any, to avoid confusion
        if "component" in job:
            del job["component"]

    return job



# --- Expose Starlette app for uvicorn ---

# Use sse_app for SSE transport (required for remote MCP connections)
app = mcp.sse_app()

if __name__ == "__main__":
    # Run with stdio transport for local Cursor/client usage
    # For production (Render), use 'uvicorn src.mcp_server:app --host 0.0.0.0 --port 8000'
    mcp.run()
