import sys
import os
import json
import shutil
from pathlib import Path

# Add root to path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

from src.celstate.processor import MediaProcessor

def fix_vine():
    print("Fixing Vine Transparency...")
    
    studio_dir = Path("web-client/public/celstate-assets/vine-decoration")
    
    white_path = studio_dir / "vine_white.png"
    black_path = studio_dir / "vine_black.png"
    
    if not white_path.exists() or not black_path.exists():
        print("Error: Source files not found.")
        return

    # Initialize Processor
    processor = MediaProcessor()
    
    # Process Image (This performs the Difference Matting)
    # output to the same directory
    result = processor.process_image(
        white_path=white_path,
        black_path=black_path,
        name="vine",
        output_dir=studio_dir
    )
    
    print(f"Transparency generated: {studio_dir / 'vine.png'}")
    
    # Update Manifest to point to the transparent image
    # We also rely on the processor's metrics which are far more accurate
    component_data = result["component"]["manifest"]
    
    # We need to adapt the processor's output to the simple format needed by CelstateContainer
    # The processor returns a complex "component" structure.
    # CelstateContainer expects:
    # { manifest: { intrinsics: { ... }, assets: { image_final: ... } } }
    
    # Let's map it.
    intrinsics = component_data["intrinsics"]
    
    # Note: Processor uses "size" {width, height}, schema uses "layout_bounds"?
    # Let's check the schema in CelstateContainer.tsx
    # It expects: safe_zone, layout_bounds, slice_insets.
    # Processor returns all of these in "intrinsics".
    
    final_manifest = {
        "manifest": {
            "intrinsics": intrinsics,
            "assets": {
                "image_final": "/celstate-assets/vine-decoration/vine.png"
            }
        }
    }
    
    with open(studio_dir / "manifest.json", "w") as f:
        json.dump(final_manifest, f, indent=2)
        
    print("Manifest updated with transparency and layout analysis.")

if __name__ == "__main__":
    fix_vine()
