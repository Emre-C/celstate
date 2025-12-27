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
import time
import io
from pathlib import Path

from google import genai
from google.genai import types
from PIL import Image

# Initialize client (reads GEMINI_API_KEY from environment)
client = genai.Client()

# Model IDs
IMAGE_MODEL = "gemini-2.5-flash-image"
VIDEO_MODEL = "veo-3.1-fast-generate-preview"

# ============================================================================
# MOBILE-FIRST CONSTANTS (Opinionated, baked-in)
# ============================================================================

# React Native density buckets - we generate @3x and downsample
MOBILE_BASE_SIZE = 1024  # @3x size (iPhone Pro Max logical width ~430 * 3 ≈ 1290)

# Mobile UI prompt enhancements - always added
MOBILE_IMAGE_CONTEXT = (
    "Mobile app UI element. "
    "High contrast, crisp edges, touch-friendly proportions. "
    "Clean vector-style rendering. "
    "Suitable for dark and light mode backgrounds."
)

MOBILE_VIDEO_CONTEXT = (
    "Smooth, subtle animation suitable for mobile UI. "
    "Looping seamlessly. Battery-efficient motion (no rapid changes). "
    "Works as a background or accent animation."
)

# Output directories (relative to project root)
STUDIO_DIR = ".agent/studio"
ASSETS_DIR = "assets/generated"


def _enhance_prompt_for_mobile(prompt: str, asset_type: str) -> str:
    """Inject mobile-specific context into user prompt."""
    context = MOBILE_IMAGE_CONTEXT if asset_type == "image" else MOBILE_VIDEO_CONTEXT
    return f"{prompt}. {context}"


def generate_image_asset(prompt: str, name: str, output_dir: str) -> dict:
    """
    Difference Matting workflow optimized for mobile.
    
    Returns:
        Dict with paths to white, black, and final processed asset
    """
    studio_path = Path(output_dir) / STUDIO_DIR / name
    studio_path.mkdir(parents=True, exist_ok=True)
    
    # Enhance prompt with mobile context
    mobile_prompt = _enhance_prompt_for_mobile(prompt, "image")
    
    # PASS 1: Generate on WHITE background
    print(f"📱 Generating mobile asset: {name}")
    print(f"🎨 Pass 1: White background ({IMAGE_MODEL})...")
    
    prompt_white = (
        f"{mobile_prompt}. "
        "Isolated on a solid pure white background (HEX #FFFFFF). "
        "No gradient. Flat, even lighting. No shadows on background. "
        "Centered composition with padding for touch targets."
    )
    
    response_white = client.models.generate_content(
        model=IMAGE_MODEL,
        contents=[prompt_white],
    )
    
    white_image = None
    white_bytes = None
    for part in response_white.parts:
        if part.inline_data is not None:
            white_image = part.as_image()
            white_bytes = part.inline_data.data
            break
    
    if white_image is None or white_bytes is None:
        raise RuntimeError("Failed to generate image")
    
    path_white = studio_path / f"{name}_white.png"
    white_image.save(str(path_white))
    print(f"   ✓ {path_white}")
    
    # PASS 2: Edit to BLACK background
    print(f"🎨 Pass 2: Black background...")
    
    edit_prompt = (
        "Change the background to solid pure black (HEX #000000). "
        "Keep the object identical - same position, size, lighting."
    )
    
    image_part = types.Part.from_bytes(data=white_bytes, mime_type="image/png")
    
    response_black = client.models.generate_content(
        model=IMAGE_MODEL,
        contents=[edit_prompt, image_part],
    )
    
    black_image = None
    for part in response_black.parts:
        if part.inline_data is not None:
            black_image = part.as_image()
            break
    
    if black_image is None:
        raise RuntimeError("Failed to edit to black background")
    
    path_black = studio_path / f"{name}_black.png"
    black_image.save(str(path_black))
    print(f"   ✓ {path_black}")
    
    print(f"\n✅ Matting pair ready for processing:")
    print(f"   White: {path_white}")
    print(f"   Black: {path_black}")
    print(f"\n💡 Next: python media_processor.py --white {path_white} --black {path_black} --name {name}")
    
    return {
        "name": name,
        "white": str(path_white),
        "black": str(path_black),
    }


def generate_video_asset(prompt: str, name: str, output_dir: str) -> dict:
    """
    Green screen video generation optimized for mobile.
    
    Square 1:1 aspect ratio, 6 seconds, optimized for UI overlays.
    """
    studio_path = Path(output_dir) / STUDIO_DIR / name
    studio_path.mkdir(parents=True, exist_ok=True)
    
    # Enhance prompt with mobile context
    mobile_prompt = _enhance_prompt_for_mobile(prompt, "video")
    
    engineering_prompt = (
        f"{mobile_prompt}. "
        "Cinematic 3D render. Seamless loop. "
        "Isolated on solid neon green background (HEX #00FF00). "
        "Static camera, object motion only. "
        "No green reflections. Matte surface finish."
    )
    
    print(f"📱 Generating mobile video: {name}")
    print(f"🎥 Rendering ({VIDEO_MODEL})...")
    print(f"   This may take 2-5 minutes...")
    
    operation = client.models.generate_videos(
        model=VIDEO_MODEL,
        prompt=engineering_prompt,
        config={
            "number_of_videos": 1,
            "aspect_ratio": "1:1",      # Square for mobile UI
            "duration_seconds": 6,       # Optimal loop length
            "resolution": "720p",        # Mobile-optimized
        },
    )
    
    poll_count = 0
    while not operation.done:
        poll_count += 1
        print(f"   ...({poll_count * 10}s)...")
        time.sleep(10)
        operation = client.operations.get(operation)
    
    generated_video = operation.response.generated_videos[0]
    client.files.download(file=generated_video.video)
    
    output_path = studio_path / f"{name}_green.mp4"
    generated_video.video.save(str(output_path))
    
    print(f"\n✅ Video ready for processing: {output_path}")
    print(f"\n💡 Next: python media_processor.py --video {output_path} --name {name}")
    
    return {
        "name": name,
        "video": str(output_path),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Mobile Asset Generator (React Native/Expo)"
    )
    parser.add_argument(
        "--type", "-t",
        choices=["image", "video"],
        required=True,
        help="Asset type",
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="What to generate",
    )
    parser.add_argument(
        "--name", "-n",
        required=True,
        help="Asset name (e.g., 'potion_bottle', 'sparkle_effect')",
    )
    parser.add_argument(
        "--output", "-o",
        default=".",
        help="Project root directory (default: current)",
    )
    
    args = parser.parse_args()
    
    # Validate API key
    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GOOGLE_API_KEY"):
        print("❌ Set GEMINI_API_KEY environment variable")
        return 1
    
    # Sanitize name
    name = args.name.replace(" ", "_").lower()
    
    try:
        if args.type == "image":
            result = generate_image_asset(args.prompt, name, args.output)
        else:
            result = generate_video_asset(args.prompt, name, args.output)
            
        import json
        print(f"__JSON_START__")
        print(json.dumps(result))
        print(f"__JSON_END__")
        return 0
    except Exception as e:
        print(f"❌ {e}")
        return 1


if __name__ == "__main__":
    exit(main())
