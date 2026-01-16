"""Canonical API adapter over the Celstate core library."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from celstate.contract import (
    normalize_layout_intent,
    resolve_asset_type,
    validate_job_create_request,
)
from celstate.generator import MediaGenerator
from celstate.job_store import JobStore
from celstate.orchestrator import Orchestrator
from celstate.processor import MediaProcessor

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = PROJECT_ROOT / "jobs"

job_store = JobStore(JOBS_DIR)

app = FastAPI(title="Celstate API", version="1.0")


class JobCreateRequest(BaseModel):
    prompt: str
    style_context: Optional[str] = ""
    asset_type: Optional[str] = None
    layout_intent: Optional[str] = None
    render_size_hint: Optional[int] = None
    name: Optional[str] = None


def _validation_error(details: str) -> Dict[str, str]:
    return {"error": "Validation Failed", "details": details}


def _internal_error(details: str) -> Dict[str, str]:
    return {"error": "Internal Error", "details": details}


def _run_job_async(orchestrator: Orchestrator, job_id: str) -> None:
    thread = threading.Thread(target=orchestrator.run_job, args=(job_id,), daemon=True)
    thread.start()


def generate_asset(
    prompt: str,
    style_context: Optional[str] = "",
    asset_type: Optional[str] = None,
    layout_intent: Optional[str] = None,
    render_size_hint: Optional[int] = None,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    validation_error = validate_job_create_request(
        prompt=prompt,
        asset_type=asset_type,
        render_size_hint=render_size_hint,
    )
    if validation_error:
        return _validation_error(validation_error)

    resolved_asset_type = resolve_asset_type(asset_type, prompt)
    resolved_layout_intent = normalize_layout_intent(layout_intent)
    resolved_style_context = style_context or ""

    try:
        generator = MediaGenerator()
        processor = MediaProcessor()
        orchestrator = Orchestrator(job_store, generator, processor)
    except Exception as exc:  # pragma: no cover - env dependent
        return _internal_error(str(exc))

    job = job_store.create_job(
        asset_type=resolved_asset_type,
        prompt=prompt,
        style_context=resolved_style_context,
        layout_intent=resolved_layout_intent,
        name=name,
        render_size_hint=render_size_hint,
    )

    _run_job_async(orchestrator, job["id"])

    return {"job_id": job["id"], "status": "queued"}


def _map_job_status(job: Dict[str, Any]) -> Dict[str, Any]:
    status = job.get("status")

    if status in {"queued", "running"}:
        return {"job_id": job["id"], "status": "processing", "retry_after": 10}

    if status == "succeeded":
        return {
            "job_id": job["id"],
            "status": "succeeded",
            "component": job.get("component"),
        }

    if status == "failed":
        response = {
            "job_id": job["id"],
            "status": "failed",
            "error": job.get("error") or "Job failed",
        }
        if job.get("retry_after"):
            response["retry_after"] = job["retry_after"]
        return response

    return {"job_id": job["id"], "status": "processing", "retry_after": 10}


def get_asset(job_id: str) -> Dict[str, Any]:
    job = job_store.get_job(job_id)
    if not job:
        return {"error": "Not Found", "details": f"Job {job_id} not found"}

    return _map_job_status(job)


@app.post("/v1/assets")
def create_asset(request: JobCreateRequest) -> Dict[str, Any]:
    return generate_asset(**request.model_dump())


@app.get("/v1/assets/{job_id}")
def read_asset(job_id: str) -> Dict[str, Any]:
    return get_asset(job_id)
