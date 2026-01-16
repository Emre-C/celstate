#!/usr/bin/env python
"""
Generate landing page assets for Perfect Transparency comparison.

Generates:
1. original.png - Fluffy dog with natural background (from white pass)
2. our-result.png - Dog with perfect transparency (Celstate pipeline)
3. competitor-result.png - Dog with intentional artifacts (crappy removal)
4. zoom-ours.png - 4x crop of our result
5. zoom-competitor.png - 4x crop of competitor result

Usage:
    uv run scripts/landing_page/generate_landing_assets.py
"""

from dotenv import load_dotenv
load_dotenv()

import sys
import os
from pathlib import Path
import shutil

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from src.celstate.generator import MediaGenerator
from src.celstate.processor import MediaProcessor

# Output directory for landing page assets
OUTPUT_DIR = project_root / "landing_assets"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("Generating Landing Page Assets")
    print("=" * 60)
    
    # Initialize generator
    generator = MediaGenerator()
    processor = MediaProcessor()
    
    # Temporary studio directory
    studio_dir = OUTPUT_DIR / "studio"
    studio_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Generate fluffy dog with dual-pass
    dog_prompt = (
        "A fluffy Pomeranian dog with luxurious orange-cream fur, "
        "sitting facing forward, happy expression with tongue slightly out. "
        "The fur has fine wispy strands around edges, especially around ears and chest. "
        "High detail photography style."
    )
    
    print("\n[1/2] Generating fluffy dog (white/black passes)...")
    print(f"    Prompt: {dog_prompt[:60]}...")
    
    try:
        paths = generator.generate_image_pair(
            prompt=dog_prompt,
            name="fluffy_dog",
            studio_dir=studio_dir,
        )
        print(f"    ✅ White pass: {paths['white']}")
        print(f"    ✅ Black pass: {paths['black']}")
        
        # Copy white pass as the "original" image (with white background)
        original_path = OUTPUT_DIR / "original.png"
        shutil.copy2(paths["white"], original_path)
        print(f"    ✅ Saved original.png (white pass copy)")
        
        # 2. Process with difference matting for perfect result
        print("\n[2/2] Processing with difference matting (our result)...")
        output_dir = OUTPUT_DIR / "matted"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        result = processor.process_image(
            white_path=Path(paths["white"]),
            black_path=Path(paths["black"]),
            name="our_result",
            output_dir=output_dir
        )
        
        # Copy to final location
        our_result_src = output_dir / "our_result.png"
        our_result_dst = OUTPUT_DIR / "our-result.png"
        shutil.copy2(our_result_src, our_result_dst)
        print(f"    ✅ Saved our-result.png (perfect transparency)")
        
        print("\n" + "=" * 60)
        print("SUCCESS! Generated assets:")
        print("=" * 60)
        print(f"  - {original_path}")
        print(f"  - {our_result_dst}")
        print(f"\nWhite/Black passes saved in: {studio_dir}")
        print(f"\nNext steps:")
        print(f"  1. Run: uv run scripts/landing_page/generate_competitor_result.py")
        print(f"  2. Run: uv run scripts/landing_page/generate_zoom_crops.py")
        
    except Exception as e:
        print(f"\n❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
