"""
Hapnington Media Engine: Orchestrator
=====================================
Auto-bootstrapping script to generate and process assets in one go.
Dependency-free entry point (uses only Python Standard Library).

Usage:
    python .agent/tools/media_engine.py --prompt "Glass bottle" --type image --name potion
"""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add project root to path so we can import src
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(PROJECT_ROOT))

from src.engine.generator import MediaGenerator
from src.engine.processor import MediaProcessor

def main():
    load_dotenv()
    
    parser = argparse.ArgumentParser(description="AI Media Engine Orchestrator (Legacy Wrapper)")
    parser.add_argument("--prompt", "-p", required=True, help="Description of asset")
    parser.add_argument("--type", "-t", choices=["image", "video"], required=True)
    parser.add_argument("--name", "-n", required=True, help="Filename (no extension)")
    args = parser.parse_args()
    
    name = args.name.replace(" ", "_").lower()
    studio_dir = PROJECT_ROOT / ".agent" / "studio" / name
    output_dir = PROJECT_ROOT / "assets" / "generated"
    
    print(f"🚀 Starting Asset Pipeline: {name} ({args.type})")
    
    try:
        generator = MediaGenerator()
        processor = MediaProcessor()
        
        if args.type == "image":
            print(f"🎨 Generating white/black passes...")
            paths = generator.generate_image_pair(args.prompt, name, studio_dir)
            
            print(f"⚡ Processing matting...")
            result = processor.process_image(
                white_path=Path(paths["white"]),
                black_path=Path(paths["black"]),
                name=name,
                output_dir=output_dir / "images"
            )
        else:
            print(f"🎥 Generating green screen video...")
            video_path = generator.generate_video(args.prompt, name, studio_dir)
            
            print(f"⚡ Processing chromakey...")
            result = processor.process_video(
                video_path=Path(video_path),
                name=name,
                output_dir=output_dir / "videos"
            )

        print("\n✨ Pipeline Complete!")
        if "variants" in result:
            print(f"   Created {len(result['variants'])} variants.")
            for v in result['variants']:
                 print(f"   - {v['scale']}: {Path(v['file']).relative_to(PROJECT_ROOT)}")
        elif "file" in result:
             print(f"   Created: {Path(result['file']).relative_to(PROJECT_ROOT)}")
             
    except Exception as e:
        print(f"❌ Pipeline failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
