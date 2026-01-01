"""
Hapnington Media Engine: Media Processor
=========================================
Opinionated asset processing for smartphone apps (React Native/Expo).

Auto-generates @1x, @2x, @3x density variants for images.
Videos are optimized at 512px/15fps for battery-efficient animations.

Usage:
    python media_processor.py --white path/white.png --black path/black.png --name icon
    python media_processor.py --video path/video.mp4 --name particles
"""

import argparse
import json
from pathlib import Path
from src.engine.processor import MediaProcessor

def main():
    parser = argparse.ArgumentParser(description="Mobile Asset Processor (Legacy Wrapper)")
    parser.add_argument("--white", "-w", help="White background image")
    parser.add_argument("--black", "-b", help="Black background image")
    parser.add_argument("--video", "-v", help="Green screen video")
    parser.add_argument("--name", "-n", required=True, help="Asset name")
    parser.add_argument("--output", "-o", default=".", help="Project root")
    args = parser.parse_args()

    name = args.name.replace(" ", "_").lower()
    processor = MediaProcessor()
    
    # Legacy tool expects output in assets/generated
    output_base = Path(args.output) / "assets" / "generated"

    try:
        if args.white and args.black:
            output_dir = output_base / "images"
            result = processor.process_image(
                white_path=Path(args.white),
                black_path=Path(args.black),
                name=name,
                output_dir=output_dir
            )
            result["status"] = "success"
        elif args.video:
            output_dir = output_base / "videos"
            result = processor.process_video(
                video_path=Path(args.video),
                name=name,
                output_dir=output_dir
            )
            result["status"] = "success"
        else:
            print("❌ Provide --white + --black (image) or --video")
            return 1
            
        print("__JSON_START__")
        print(json.dumps(result, indent=2))
        print("__JSON_END__")
        return 0
    except Exception as e:
        print(f"❌ {e}")
        return 1

if __name__ == "__main__":
    exit(main())
