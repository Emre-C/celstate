import os
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from src.engine.generator import MediaGenerator
from src.engine.processor import MediaProcessor
from src.engine.job_store import JobStore
from src.engine.orchestrator import Orchestrator

# Load environment variables
load_dotenv()

app = FastAPI(title="AI Media Creator V1", description="API for generating transparent assets optimized for AI agents.")

# Initialize components
BASE_DIR = Path(__file__).resolve().parent.parent.parent
JOB_STORE_DIR = BASE_DIR / "var" / "jobs"
job_store = JobStore(JOB_STORE_DIR)
generator = MediaGenerator()
processor = MediaProcessor()
orchestrator = Orchestrator(job_store, generator, processor)

# Serve assets from var/jobs
app.mount("/assets", StaticFiles(directory=str(JOB_STORE_DIR)), name="assets")

class AssetRequest(BaseModel):
    type: str  # "image" or "video"
    prompt: str
    name: Optional[str] = None

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
    assets: Dict[str, Optional[str]]  # filename -> URL (None until resolved)
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

@app.post("/v1/assets", response_model=JobResponse, status_code=201)
async def create_asset(request: AssetRequest, background_tasks: BackgroundTasks):
    if request.type not in ["image", "video"]:
        raise HTTPException(status_code=400, detail="Type must be 'image' or 'video'")
    
    job = job_store.create_job(request.type, request.prompt, request.name)
    background_tasks.add_task(orchestrator.run_job, job["id"])
    
    return job

def _resolve_asset_urls(job: dict, base_url: str) -> dict:
    """Populate component asset URLs. Inline for AI maintainability."""
    if job.get("status") != "succeeded":
        return job
    
    component = job.get("component")
    if not component:
        return job
    
    # Resolve asset filenames to full URLs
    resolved_assets = {}
    for filename in component.get("assets", {}).keys():
        resolved_assets[filename] = f"{base_url}/assets/{job['id']}/outputs/{filename}"
    
    # Update job with resolved component
    job["component"]["assets"] = resolved_assets
    return job

@app.get("/v1/assets/{job_id}", response_model=JobResponse)
async def get_asset_status(job_id: str, request: Request):
    job = job_store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Resolve URLs for AI agent consumption
    base_url = str(request.base_url).rstrip("/")
    job = _resolve_asset_urls(job, base_url)
    
    return job

@app.get("/v1/assets", response_model=List[JobResponse])
async def list_assets():
    return job_store.list_jobs()

@app.get("/")
async def root():
    return {
        "service": "AI Media Creator V1",
        "manifest_version": "0.1",
        "capabilities": ["difference_matting", "chromakey", "component_manifest"],
        "endpoints": {
            "create": {"method": "POST", "path": "/v1/assets", "body": {"type": "image|video", "prompt": "string", "name": "optional"}},
            "status": {"method": "GET", "path": "/v1/assets/{id}", "returns": "JobResponse with resolved component manifest"},
            "list": {"method": "GET", "path": "/v1/assets"}
        },
        "docs": "/docs"
    }
