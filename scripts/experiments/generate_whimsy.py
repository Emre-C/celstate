#!/usr/bin/env python
"""
Experiment: Whimsy Stress Test - Asset Generation

Generates anchored decoration assets (vine, texture/sticker).

Usage:
    uv run scripts/experiments/generate_whimsy.py
"""
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
    
    # Asset definitions for Whimsy Test
    assets_to_generate = [
        {
            "name": "Vine Decoration",
            "asset_type": "decoration",
            "prompt": (
                "A lush, magical ivy vine hanging vertically. "
                "It originates from the top-right corner and drapes downwards. "
                "Features delicate green leaves, tiny glowing spirit orbs, and winding tendrils. "
                "The left side is mostly empty transparency."
            ),
            "style_context": (
                "Studio Ghibli style, hand-painted, cel-shaded, vibrant greens, magical atmosphere, "
                "solid lines, no background"
            ),
            "render_size_hint": 300, 
            "layout_intent": "auto",
        },
        # We could add more, e.g. a "Ghibli Sticker" or "Soot Sprite"
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
            generated_jobs.append({"name": asset_def["name"], "id": job_id, "status": "succeeded"})
        else:
            error = result.get("error", "Unknown error") if result else "Job not found"
            print(f"❌ FAILED: {asset_def['name']}")
            print(f"   Error: {error}")
            generated_jobs.append({"name": asset_def["name"], "id": job_id, "status": "failed", "error": error})
    
    # Output for updating App.tsx
    print(f"\n{'='*60}")
    print("Whimsy Generated IDs:")
    print(f"{'='*60}")
    for job in generated_jobs:
        if job["status"] == "succeeded":
             print(f"{job['name']}: '{job['id']}'")

if __name__ == "__main__":
    main()
