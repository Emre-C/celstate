#!/usr/bin/env python
"""
Nano Banana Protocol Test - Asset Generation

Generates "Tag" variants using the new Nano Tier logic (<64px) to solve the "muddy downscaling" problem.
This forces a "High-Contrast, Zero-Texture" strategy.

Usage:
    uv run scripts/experiments/generate_nano_test.py
"""
# Load environment variables from .env FIRST
from dotenv import load_dotenv
load_dotenv()

import sys
import os
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from src.celstate.job_store import JobStore
from src.celstate.generator import MediaGenerator
from src.celstate.processor import MediaProcessor
from src.celstate.orchestrator import Orchestrator


def main():
    # Initialize the pipeline
    jobs_dir = project_root / "jobs"
    job_store = JobStore(jobs_dir)
    generator = MediaGenerator()
    processor = MediaProcessor()
    orchestrator = Orchestrator(job_store, generator, processor)
    
    # Common style for consistency
    style_context = (
        "Studio Ghibli aesthetic, hand-painted watercolor textures, "
        "warm earth tones (moss green, leather brown, cream parchment), "
        "organic edges with subtle hand-drawn imperfections, nostalgic and cozy."
    )
    
    # Asset definitions for Nano Test
    assets_to_generate = [
        {
            "name": "Nano Tag (New Protocol)",
            "asset_type": "container",
            "prompt": (
                "A wide, landscape-oriented rounded rectangle tag shape. "
                "Simple, clean watercolor texture. "
                "Soft organic edges. "
                "Interior must be transparent."
            ),
            "style_context": "Studio Ghibli style vector art, flat colors, high contrast, clean bold outlines, no gradients. Iconography style.",
            "render_size_hint": 60, # Approaching the 64px limit
            "layout_intent": "row",
        },
        # Control group (just above threshold) to verify the switch
        {
            "name": "Small Tag (Control)",
            "asset_type": "container",
            "prompt": (
                "A small tag shape. "
                "Simple, clean watercolor texture. "
                "Soft organic edges. "
                "Interior must be transparent."
            ),
            "style_context": style_context,
            "render_size_hint": 80, # > 64px Standard S Tier
            "layout_intent": "row",
        }
    ]
    
    generated_jobs = []
    
    for asset_def in assets_to_generate:
        print(f"\n{'='*60}")
        print(f"Generating: {asset_def['name']}")
        print(f"{'='*60}")
        
        # Create the job
        job = job_store.create_job(
            asset_type=asset_def["asset_type"],
            prompt=asset_def["prompt"],
            style_context=asset_def["style_context"],
            layout_intent=asset_def["layout_intent"],
            render_size_hint=asset_def["render_size_hint"],
        )
        
        job_id = job["id"]
        print(f"Job ID: {job_id}")
        
        # Run the job through the pipeline
        orchestrator.run_job(job_id)
        
        # Check result
        result = job_store.get_job(job_id)
        if result and result.get("status") == "succeeded":
            print(f"✅ SUCCESS: {asset_def['name']}")
            print(f"   Job ID: {job_id}")
            generated_jobs.append({
                "name": asset_def["name"], 
                "id": job_id, 
                "status": "succeeded",
                "size_hint": asset_def["render_size_hint"]
            })
        else:
            error = result.get("error", "Unknown error") if result else "Job not found"
            print(f"❌ FAILED: {asset_def['name']}")
            print(f"   Error: {error}")
            generated_jobs.append({"name": asset_def["name"], "id": job_id, "status": "failed", "error": error})
    
    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY - Nano Banana Protocol Test")
    print(f"{'='*60}")
    print(f"{'Asset':<30} {'Status':<12} {'Size':<6} {'Job ID'}")
    print(f"{'-'*60}")
    
    for job in generated_jobs:
        status_icon = "✅" if job["status"] == "succeeded" else "❌"
        size = str(job.get("size_hint", "-"))
        print(f"{job['name']:<30} {status_icon + ' ' + job['status']:<12} {size:<6} {job['id']}")
    
    # Output for updating App.tsx
    print(f"\n{'='*60}")
    print("JSON for Asset Configuration:")
    print(f"{'='*60}")
    print("const NANO_TEST_VARIANTS = {")
    for job in generated_jobs:
        if job["status"] == "succeeded":
            key = "unknown"
            if "Nano" in job["name"]: key = "nano"
            elif "Control" in job["name"]: key = "control"
            
            print(f"  {key}: '{job['id']}', // size_hint: {job.get('size_hint')}")
    print("};")


if __name__ == "__main__":
    main()
