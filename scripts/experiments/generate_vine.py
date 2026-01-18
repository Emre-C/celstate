import sys
import os
import json
from pathlib import Path

# Add root to path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

from src.celstate.generator import MediaGenerator

def generate_vine():
    print("Generating Vine Decoration...")
    generator = MediaGenerator()
    studio_dir = Path("web-client/public/celstate-assets/vine-decoration")
    studio_dir.mkdir(parents=True, exist_ok=True)

    # Settings
    # Prompt emphasizes vertical flow and right-attachment
    # Note: The generator prompt will help, but "attached to right" implies specific composition.
    # The 9:16 canvas is tall. To make it drape down the right, we should ask for it.
    prompt = (
        "A lush, magical ivy vine hanging vertically. "
        "It originates from the top-right corner and drapes downwards. "
        "Features delicate green leaves, tiny glowing spirit orbs, and winding tendrils. "
        "The left side is mostly empty transparency."
    )
    style = "Studio Ghibli style, hand-painted, cel-shaded, vibrant greens, magical atmosphere"
    asset_type = "decoration"
    # Size hint: Let's assume a reasonable width for a phone screen decoration. 
    # If the phone is 430px wide, and this is a side element... maybe 120px wide? 
    # But height will be 16/9 * width. 120 * 1.77 = ~213px. 
    # Or we can go bigger. Let's aim for a high quality asset.
    # 400px width implies ~700px height. That's a good Hero Grade (Tier L/M).
    size_hint = 300 
    
    paths = generator.generate_image(
        prompt=prompt,
        name="vine",
        studio_dir=studio_dir,
        asset_type=asset_type,
        style_context=style,
        render_size_hint=size_hint
    )
    
    # Mock Manifest
    # For a decoration, safe_zone and slice_insets are less critical as usually it's not a container.
    # But CelstateContainer expects them.
    # We will treat it as a static image (0 slices).
    # NOTE: The CelstateContainer logic for 0 slices might depend on slice_insets being 0.
    manifest = {
        "manifest": {
            "intrinsics": {
                "content_zones": {},
                "slice_insets": {
                    "top": 0,
                    "right": 0,
                    "bottom": 0,
                    "left": 0
                },
                "safe_zone": { 
                    "x": 0, "y": 0, "width": size_hint, "height": int(size_hint * (16/9)) 
                },
                "layout_bounds": {
                    "x": 0, "y": 0, "width": size_hint, "height": int(size_hint * (16/9))
                }
            },
            "assets": {
                "image_final": "/celstate-assets/vine-decoration/vine_input.png"
            }
        }
    }
    
    with open(studio_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
        
    print(f"Asset generated at {studio_dir}")

if __name__ == "__main__":
    generate_vine()
