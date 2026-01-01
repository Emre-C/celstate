"""
Hapnington Media Engine: Media Generator
=========================================
Opinionated asset generation for smartphone apps (React Native/Expo).

All outputs are optimized for mobile:
- Images: @3x resolution (1024px), auto-scales to @1x/@2x
- Videos: Square 1:1, 6s loops, 720p
- Prompts: Auto-enhanced with mobile UI context

Usage:
    python media_generator.py --type image --prompt "Glass potion bottle" --name potion
    python media_generator.py --type video --prompt "Floating particles" --name particles
"""

import argparse
import os
import json
from pathlib import Path
from src.engine.generator import MediaGenerator

def main():
    parser = argparse.ArgumentParser(description="Mobile Asset Generator (Legacy Wrapper)")
    parser.add_argument("--type", "-t", choices=["image", "video"], required=True)
    parser.add_argument("--prompt", "-p", required=True)
    parser.add_argument("--name", "-n", required=True)
    parser.add_argument("--output", "-o", default=".")
    args = parser.parse_args()

    name = args.name.replace(" ", "_").lower()
    # Output to .agent/studio within the specified output project root
    studio_dir = Path(args.output) / ".agent" / "studio" / name
    
    try:
        generator = MediaGenerator()
        if args.type == "image":
            result = generator.generate_image_pair(args.prompt, name, studio_dir)
            result["name"] = name
        else:
            video_path = generator.generate_video(args.prompt, name, studio_dir)
            result = {"name": name, "video": video_path}
            
        print("__JSON_START__")
        print(json.dumps(result))
        print("__JSON_END__")
        return 0
    except Exception as e:
        print(f"❌ {e}")
        return 1

if __name__ == "__main__":
    exit(main())
