
"""
V2 Prototype: Background Swap (Image-to-Transparency)
Verifies that Celstate V2 can take an opaque input image and make it transparent.
"""

import os
import sys
from pathlib import Path
import cv2

# Add project root to path
sys.path.append(os.getcwd())

# Load .env manually
env_path = Path(".env")
if env_path.exists():
    print(f"Loading environment from {env_path}")
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                # Strip quotes if present
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                if value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                os.environ[key] = value

from src.celstate_v2.service import CelstateService

def main():

    print("Initializing Celstate V2 Service...")
    service = CelstateService()
    
    # Setup: Generate a dummy image first (since we might not have one handy)
    print("Generating Opaque Test Image (Red Apple on Table)...")
    prompt = "A shiny red apple on a wooden table. High quality photo."
    dummy_image = service.canvas.generate_image(prompt)
    
    # Save dummy
    dummy_path = Path("v2_test_opaque_input.png")
    dummy_image.save(dummy_path)
    print(f"Saved test input to: {dummy_path}")
    
    # TEST: Process Existing Image
    print("\n--- TEST START: Image-to-Transparency ---")
    print(f"Processing {dummy_path}...")
    
    # Process image (this should create a job and save files)
    result = service.process_existing_image(str(dummy_path))
    job_id = result.get("job_id")
    
    if not job_id:
        print("ERROR: No Job ID returned!")
        sys.exit(1)
        
    print(f"Job ID: {job_id}")
    
    # Verify persistence
    job_dir = Path("jobs") / job_id
    
    expected_files = [
        job_dir / "studio" / "original.png",
        job_dir / "studio" / "gen_white.png",
        job_dir / "studio" / "gen_black.png",
        job_dir / "outputs" / "transparent.png",
        job_dir / "outputs" / "layout.json",
        job_dir / "job.json"
    ]
    
    all_exist = True
    for f in expected_files:
        if f.exists():
            print(f"[OK] Found {f}")
        else:
            print(f"[MISSING] {f}")
            all_exist = False
            
    if not all_exist:
        print("\nFAILURE: Some expected files are missing.")
        sys.exit(1)
    
    print(f"\nSuccess! All artifacts persisted to: {job_dir}")
    print(f"Safe Zone Detected: {result['layout'].safe_zone}")

if __name__ == "__main__":
    main()
