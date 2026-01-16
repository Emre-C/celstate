import sys
import os
import time
import json
from pathlib import Path

# Add root to path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

from src.celstate.job_store import JobStore
from src.celstate.generator import MediaGenerator
from src.celstate.processor import MediaProcessor
from src.celstate.orchestrator import Orchestrator

def test_pipeline():
    print("--- Starting Decoration Pipeline Test ---")

    # 1. Setup
    # Use the standard jobs location
    base_job_dir = Path("jobs")
    job_store = JobStore(base_job_dir)
    
    try:
        generator = MediaGenerator()
        processor = MediaProcessor()
        orchestrator = Orchestrator(job_store, generator, processor)
    except Exception as e:
        print(f"Failed to initialize engine components: {e}")
        return

    # 2. Create Job
    prompt = (
        "A lush, magical ivy vine hanging vertically. "
        "It originates from the top-right corner and drapes downwards. "
        "Features delicate green leaves, tiny glowing spirit orbs, and winding tendrils. "
        "The left side is mostly empty transparency."
    )
    style = "Studio Ghibli style, hand-painted, cel-shaded, vibrant greens, magical atmosphere"
    
    # render_size_hint=300 for a detailed mobile decoration
    job_data = job_store.create_job(
        asset_type="decoration",
        prompt=prompt,
        style_context=style,
        render_size_hint=300
    )
    job_id = job_data["id"]
    print(f"Job Created: {job_id}")

    # 3. Run Job (Synchronously for test)
    print("Running Orchestrator...")
    orchestrator.run_job(job_id)

    # 4. Verify
    final_job = job_store.get_job(job_id)
    status = final_job.get("status")
    print(f"Job Status: {status}")
    
    if status == "succeeded":
        print("SUCCESS: Job completed successfully.")
        
        # Verify component data
        component = final_job.get("component")
        if component:
            print("Component Manifest present.")
            # Check assets
            assets = component.get("assets", {})
            print(f"Assets generated: {list(assets.keys())}")
            
            # Check file existence
            job_dir = job_store._get_job_dir(job_id)
            outputs_dir = job_dir / "outputs"
            
            # We expect [name].png (transparent) and [name]_debug.png
            name = final_job["name"]
            expected_png = outputs_dir / f"{name}.png"
            
            if expected_png.exists():
                print(f"Verified output file exists: {expected_png}")
                # Print the path so we can use it
                print(f"::OUTPUT_PATH::{expected_png}")
            else:
                print(f"FAILURE: Output PNG missing at {expected_png}")
        else:
            print("FAILURE: Component manifest missing in job data.")
            
    else:
        print(f"FAILURE: Job failed. Error: {final_job.get('error')}")

if __name__ == "__main__":
    test_pipeline()
