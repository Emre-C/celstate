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
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np

# ============================================================================
# MOBILE-FIRST CONSTANTS (Opinionated, baked-in)
# ============================================================================

# React Native density buckets
DENSITY_SCALES = {
    "@3x": 1.0,     # Full resolution (source)
    "@2x": 2/3,     # 66.7% of @3x
    "@1x": 1/3,     # 33.3% of @3x
}

# Video optimization for mobile
VIDEO_WIDTH = 512       # Mobile-optimized width
VIDEO_FPS = 15          # Battery-efficient framerate
VIDEO_QUALITY = 80      # WebP quality (0-100)

# Chroma key settings for green screen
CHROMA_COLOR = "0x00FF00"
CHROMA_SIMILARITY = 0.1
CHROMA_BLEND = 0.2

# Output directory
ASSETS_OUTPUT_DIR = "assets/generated"


def _generate_density_variants(img_rgba: np.ndarray, name: str, output_dir: Path) -> list:
    """Generate @1x, @2x, @3x WebP variants from source image."""
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    
    h, w = img_rgba.shape[:2]
    
    for suffix, scale in DENSITY_SCALES.items():
        new_w = int(w * scale)
        new_h = int(h * scale)
        
        if scale < 1.0:
            resized = cv2.resize(img_rgba, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
        else:
            resized = img_rgba
        
        filename = f"{name}{suffix}.webp"
        filepath = output_dir / filename
        cv2.imwrite(str(filepath), resized, [cv2.IMWRITE_WEBP_QUALITY, 90])
        outputs.append({
            "scale": suffix,
            "size": f"{new_w}x{new_h}",
            "file": str(filepath),
        })
        print(f"   ✓ {filename} ({new_w}x{new_h})")
    
    return outputs


def analyze_asset(img_path: str) -> dict:
    """Telemetry: Analyze transparency quality."""
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return {"error": "Cannot read file"}
    
    if len(img.shape) < 3 or img.shape[2] < 4:
        return {"error": "No alpha channel"}
    
    alpha = img[:, :, 3]
    total = alpha.size
    
    return {
        "size": f"{img.shape[1]}x{img.shape[0]}",
        "transparent": f"{np.sum(alpha == 0) / total * 100:.1f}%",
        "semi_transparent": f"{np.sum((alpha > 0) & (alpha < 255)) / total * 100:.1f}%",
        "opaque": f"{np.sum(alpha == 255) / total * 100:.1f}%",
    }


def process_image(white_path: str, black_path: str, name: str, output_dir: str) -> dict:
    """
    Difference Matting → @1x/@2x/@3x WebP variants.
    
    Algorithm: Alpha = 1 - (pixel_distance / 255)
    """
    print(f"📱 Processing image: {name}")
    print(f"🔬 Difference Matting...")
    
    img_w = cv2.imread(white_path)
    img_b = cv2.imread(black_path)
    
    if img_w is None:
        return {"error": f"Cannot read: {white_path}"}
    if img_b is None:
        return {"error": f"Cannot read: {black_path}"}
    
    img_w = img_w.astype(float)
    img_b = img_b.astype(float)
    
    if img_w.shape != img_b.shape:
        return {"error": "Size mismatch - regenerate pair"}
    
    # Alpha recovery
    diff = np.abs(img_w - img_b)
    alpha = 1.0 - (np.mean(diff, axis=2) / 255.0)
    alpha = np.clip(alpha, 0, 1)
    
    # Color recovery (un-premultiply from black)
    with np.errstate(divide='ignore', invalid='ignore'):
        color = img_b / alpha[:, :, np.newaxis]
    color = np.nan_to_num(color, nan=0.0, posinf=0.0, neginf=0.0)
    
    # Construct RGBA
    final_alpha = (alpha * 255).astype(np.uint8)
    final_bgr = np.clip(color, 0, 255).astype(np.uint8)
    rgba = cv2.merge([final_bgr[:,:,0], final_bgr[:,:,1], final_bgr[:,:,2], final_alpha])
    
    # Generate density variants
    output_path = Path(output_dir) / ASSETS_OUTPUT_DIR / "images"
    print(f"\n📦 Generating density variants...")
    variants = _generate_density_variants(rgba, name, output_path)
    
    # Telemetry on @3x
    telemetry = analyze_asset(variants[0]["file"])
    
    print(f"\n✅ Done! Files ready in: {output_path}")
    
    return {
        "status": "success",
        "name": name,
        "variants": variants,
        "telemetry": telemetry,
    }


def process_video(video_path: str, name: str, output_dir: str) -> dict:
    """
    Chroma Key → Optimized animated WebP.
    
    512px width, 15fps, looping.
    """
    print(f"📱 Processing video: {name}")
    print(f"🎬 Chroma keying...")
    
    output_path = Path(output_dir) / ASSETS_OUTPUT_DIR / "videos"
    output_path.mkdir(parents=True, exist_ok=True)
    output_file = output_path / f"{name}.webp"
    
    filter_chain = (
        f"chromakey={CHROMA_COLOR}:{CHROMA_SIMILARITY}:{CHROMA_BLEND},"
        f"scale={VIDEO_WIDTH}:-1:flags=lanczos,"
        f"fps={VIDEO_FPS}"
    )
    
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", filter_chain,
        "-c:v", "libwebp",
        "-lossless", "0",
        "-quality", str(VIDEO_QUALITY),
        "-loop", "0",
        "-an",
        "-vsync", "0",
        str(output_file),
    ]
    
    print(f"   Running FFmpeg ({VIDEO_WIDTH}px, {VIDEO_FPS}fps)...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        return {"error": result.stderr}
    
    # Get file size
    size_kb = os.path.getsize(output_file) / 1024
    
    print(f"\n✅ Done! {output_file} ({size_kb:.1f} KB)")
    
    return {
        "status": "success",
        "name": name,
        "file": str(output_file),
        "size_kb": round(size_kb, 1),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Mobile Asset Processor (React Native/Expo)"
    )
    
    # Image mode
    parser.add_argument("--white", "-w", help="White background image")
    parser.add_argument("--black", "-b", help="Black background image")
    
    # Video mode
    parser.add_argument("--video", "-v", help="Green screen video")
    
    # Required
    parser.add_argument("--name", "-n", required=True, help="Asset name")
    parser.add_argument("--output", "-o", default=".", help="Project root")
    
    args = parser.parse_args()
    
    name = args.name.replace(" ", "_").lower()
    
    try:
        if args.white and args.black:
            result = process_image(args.white, args.black, name, args.output)
        elif args.video:
            result = process_video(args.video, name, args.output)
        else:
            print("❌ Provide --white + --black (image) or --video")
            return 1
        
        print(f"__JSON_START__")
        print(json.dumps(result, indent=2))
        print(f"__JSON_END__")
        return 0 if result.get("status") == "success" else 1
        
    except Exception as e:
        print(f"❌ {e}")
        return 1


if __name__ == "__main__":
    exit(main())
