import sys
import os
import json
import shutil
from pathlib import Path

# Add root to path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

from src.celstate.job_store import JobStore

def deploy_vine(job_id):
    print(f"Deploying Job {job_id}...")
    
    base_job_dir = Path("jobs")
    job_store = JobStore(base_job_dir)
    job = job_store.get_job(job_id)
    
    if not job or job["status"] != "succeeded":
        print("Job not found or not succeeded")
        return

    # Prepare Target Directory
    target_dir = Path("web-client/public/celstate-assets/decoration_test")
    if target_dir.exists():
        shutil.rmtree(target_dir) # Clean start
    target_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy Image
    asset_name = job["name"]
    source_image = base_job_dir / job_id / "outputs" / f"{asset_name}.png"
    target_image = target_dir / "vine.png"
    
    shutil.copy2(source_image, target_image)
    print(f"Copied image to {target_image}")
    
    # Prepare Manifest
    # The component object from job.json is close to what we need, but usually 'component' 
    # has { manifest: { ... }, assets: { ... } }
    # CelstateContainer expects { manifest: { intrinsics: ..., assets: ... } }
    
    component = job["component"]
    
    # Construct Client Manifest
    # We override the asset path to be the local public URL
    client_manifest = {
        "manifest": {
            "intrinsics": component["manifest"]["intrinsics"],
            "assets": {
                "image_final": "/celstate-assets/decoration_test/vine.png"
            }
        }
    }
    
    with open(target_dir / "manifest.json", "w") as f:
        json.dump(client_manifest, f, indent=2)
        
    print(f"Manifest written to {target_dir / 'manifest.json'}")

if __name__ == "__main__":
    # Hardcoded ID from the previous successful run
    JOB_ID = "44b100cf-4a83-4260-947f-2413c3b949ec" 
    deploy_vine(JOB_ID)
