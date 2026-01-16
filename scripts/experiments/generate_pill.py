import sys
import os
import json
from pathlib import Path

# Add root to path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

from src.celstate.generator import MediaGenerator

def generate_pill():
    print("Generating Customer Pill...")
    generator = MediaGenerator()
    studio_dir = Path("web-client/public/celstate-assets/customer-pill")
    studio_dir.mkdir(parents=True, exist_ok=True) # Ensure directory exists

    # Settings
    prompt = "A warm, organic status pill container for a VIP customer label"
    style = "Studio Ghibli style, watercolor, soft edges, whimsical, vibrant"
    asset_type = "container"
    size_hint = 120 # Tier S (48-128px) -> Badge Grade
    
    paths = generator.generate_image_pair(
        prompt=prompt,
        name="customer_pill",
        studio_dir=studio_dir,
        asset_type=asset_type,
        style_context=style,
        render_size_hint=size_hint
    )
    
    # Create a mock manifest so CelstateContainer can use it
    # note: in a real app this comes from the backend analyzer. 
    # For this experiment, we assume standard 9-slice behavior for a pill.
    # A 120x?? pill. 
    # White/Black pass generated.
    # We need the FINAL image (white pass with transparency).
    # Since we don't have the full Compositor pipeline here running, 
    # We will just use the WHITE pass as the image and assume CSS blending or simple usage.
    # Wait, CelstateContainer uses `image_final`. 
    # We should probably run the compositor or just use the white pass.
    # For now, let's point image_final to the white pass.
    
    manifest = {
        "manifest": {
            "intrinsics": {
                "content_zones": {},
                "slice_insets": {
                    "top": 16, # approx for a pill
                    "right": 24, # sides are wider
                    "bottom": 16,
                    "left": 24
                },
                "safe_zone": { 
                    "x": 20, "y": 8, "width": 80, "height": 32 
                },
                "layout_bounds": {
                    "x": 0, "y": 0, "width": 120, "height": 48 # Check actual size later
                }
            },
            "assets": {
                "image_final": "/celstate-assets/customer-pill/customer_pill_white.png"
            }
        }
    }
    
    with open(studio_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
        
    print(f"Asset generated at {studio_dir}")
    print("Manifest created.")

if __name__ == "__main__":
    generate_pill()
