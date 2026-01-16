#!/usr/bin/env python
"""
Generate HIGH-QUALITY landing page assets using Gemini 3 Pro Image.

Uses gemini-3-pro-image-preview with 4K resolution for maximum detail,
especially important for zoomed comparisons where fur detail matters.

Generates:
1. original.png - Fluffy dog with natural background (from white pass)
2. our-result.png - Dog with perfect transparency (Celstate pipeline)

Usage:
    uv run scripts/landing_page/generate_landing_assets_4k.py
"""

from dotenv import load_dotenv
load_dotenv()

import sys
import os
import io
from pathlib import Path
import shutil

from google import genai
from google.genai import types
from PIL import Image
import numpy as np
import cv2

# Project root and output directory
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

OUTPUT_DIR = project_root / "landing_assets"

# Model configuration - Gemini 3 Pro Image for 4K quality
MODEL_ID = "gemini-3-pro-image-preview"
RESOLUTION = "4K"  # Must be uppercase: "1K", "2K", or "4K"
ASPECT_RATIO = "1:1"  # Square for dog portrait


def init_client():
    """Initialize Vertex AI client with GLOBAL endpoint.
    
    gemini-3-pro-image-preview requires the global endpoint, not a regional one.
    See: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
    """
    vertex_project = os.environ.get("VERTEX_PROJECT_ID")
    
    if not vertex_project:
        raise ValueError("VERTEX_PROJECT_ID must be set in environment")
    
    # Use 'global' location for gemini-3-pro-image-preview
    return genai.Client(
        vertexai=True,
        project=vertex_project,
        location="global"  # Required for gemini-3-pro-image-preview
    )


def generate_high_quality_image(client, prompt: str, name: str, output_dir: Path) -> Path:
    """
    Generate a high-quality image using Gemini 3 Pro Image.
    
    Returns path to saved image.
    """
    print(f"  Generating with {MODEL_ID} at {RESOLUTION} resolution...")
    
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio=ASPECT_RATIO,
            image_size=RESOLUTION,
        ),
    )
    
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=config,
    )
    
    # Extract image from response
    for part in response.parts:
        if part.inline_data is not None:
            image = Image.open(io.BytesIO(part.inline_data.data))
            output_path = output_dir / f"{name}.png"
            image.save(str(output_path))
            print(f"  ✅ Saved: {output_path} ({image.size[0]}x{image.size[1]})")
            return output_path
    
    raise RuntimeError("No image data returned from API")


def generate_image_pair_4k(client, prompt: str, studio_dir: Path):
    """
    Generate white and black pass images at 4K resolution for difference matting.
    
    Returns dict with 'white' and 'black' paths.
    """
    studio_dir.mkdir(parents=True, exist_ok=True)
    
    # Pass 1: White background
    prompt_white = (
        f"{prompt}\n\n"
        "BACKGROUND: Solid pure white (#FFFFFF). No gradient. No shadows on background. "
        "Professional studio lighting. Centered composition with padding around edges."
    )
    
    print("\n  [White Pass] Generating...")
    
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio=ASPECT_RATIO,
            image_size=RESOLUTION,
        ),
    )
    
    response_white = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt_white,
        config=config,
    )
    
    white_image = None
    white_bytes = None
    for part in response_white.parts:
        if part.inline_data is not None:
            white_bytes = part.inline_data.data
            white_image = Image.open(io.BytesIO(white_bytes))
            break
    
    if white_image is None:
        raise RuntimeError("Failed to generate white-pass image")
    
    path_white = studio_dir / "fluffy_dog_white.png"
    white_image.save(str(path_white))
    print(f"  ✅ White pass: {path_white} ({white_image.size[0]}x{white_image.size[1]})")
    
    # Pass 2: Black background (edit of white pass)
    print("\n  [Black Pass] Editing to black background...")
    
    edit_prompt = (
        "Strictly change ALL negative space from White to solid Pure Black (#000000). "
        "This includes the outer background. "
        "CRITICAL: Do not crop, zoom, or shift. Subject must match pixel-for-pixel. "
        "Keep all fur detail and edges exactly the same."
    )
    
    image_part = types.Part.from_bytes(data=white_bytes, mime_type="image/png")
    
    # Request 4K output for edit as well to match white pass resolution
    edit_config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            image_size=RESOLUTION,
        ),
    )
    
    response_black = client.models.generate_content(
        model=MODEL_ID,
        contents=[edit_prompt, image_part],
        config=edit_config,
    )
    
    black_image = None
    for part in response_black.parts:
        if part.inline_data is not None:
            black_image = Image.open(io.BytesIO(part.inline_data.data))
            break
    
    if black_image is None:
        raise RuntimeError("Failed to generate black-pass image")
    
    path_black = studio_dir / "fluffy_dog_black.png"
    black_image.save(str(path_black))
    print(f"  ✅ Black pass: {path_black} ({black_image.size[0]}x{black_image.size[1]})")
    
    return {
        "white": str(path_white),
        "black": str(path_black),
    }


def difference_matte(white_path: Path, black_path: Path, output_path: Path):
    """
    Apply difference matting to extract transparency.
    
    This is the core Celstate algorithm.
    """
    print("\n  Processing with difference matting...")
    
    img_w = cv2.imread(str(white_path))
    img_b = cv2.imread(str(black_path))
    
    if img_w is None or img_b is None:
        raise ValueError(f"Could not read input images")
    
    # Handle size mismatch (edit might return slightly different size)
    if img_w.shape != img_b.shape:
        print(f"  ⚠️  Size mismatch: white={img_w.shape}, black={img_b.shape}")
        # Resize black to match white
        img_b = cv2.resize(img_b, (img_w.shape[1], img_w.shape[0]))
    
    img_w = img_w.astype(float)
    img_b = img_b.astype(float)
    
    # Alpha recovery: Alpha = 1 - (pixel_distance / 255)
    diff = np.abs(img_w - img_b)
    alpha = 1.0 - (np.mean(diff, axis=2) / 255.0)
    alpha = np.clip(alpha, 0, 1)
    
    # Adaptive noise gate for clean edges
    threshold = 0.05
    alpha = np.where(alpha < threshold, 0, alpha)
    alpha = np.where(alpha > 0.95, 1.0, alpha)
    
    # Color recovery (un-premultiply from black)
    with np.errstate(divide='ignore', invalid='ignore'):
        color = img_b / alpha[:, :, np.newaxis]
    color = np.nan_to_num(color, nan=0.0)
    
    # Construct RGBA
    final_alpha = (alpha * 255).astype(np.uint8)
    final_bgr = np.clip(color, 0, 255).astype(np.uint8)
    rgba = cv2.merge([final_bgr[:,:,0], final_bgr[:,:,1], final_bgr[:,:,2], final_alpha])
    
    # Auto-crop to opaque bounds
    alpha_channel = rgba[:, :, 3]
    rows = np.any(alpha_channel > 0, axis=1)
    cols = np.any(alpha_channel > 0, axis=0)
    
    if np.any(rows) and np.any(cols):
        y_min, y_max = np.where(rows)[0][[0, -1]]
        x_min, x_max = np.where(cols)[0][[0, -1]]
        rgba = rgba[y_min:y_max+1, x_min:x_max+1]
    
    cv2.imwrite(str(output_path), rgba)
    h, w = rgba.shape[:2]
    print(f"  ✅ Saved: {output_path} ({w}x{h})")
    
    return output_path


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("Generating HIGH-QUALITY Landing Page Assets")
    print(f"Model: {MODEL_ID}")
    print(f"Resolution: {RESOLUTION}")
    print("=" * 60)
    
    try:
        client = init_client()
        print("✅ Vertex AI client initialized")
    except Exception as e:
        print(f"❌ Failed to initialize client: {e}")
        return 1
    
    studio_dir = OUTPUT_DIR / "studio"
    
    # The fluffy dog prompt - emphasizing fine detail for 4K
    dog_prompt = (
        "A fluffy Pomeranian dog with luxurious orange-cream fur, "
        "sitting facing forward, happy expression with tongue slightly out. "
        "The fur has fine wispy strands around edges, especially around ears, chest, and shoulders. "
        "Individual fur strands visible. Extremely high detail, professional pet photography, "
        "shallow depth of field, studio lighting."
    )
    
    print("\n[Step 1/3] Generating white and black passes...")
    print(f"Prompt: {dog_prompt[:80]}...")
    
    try:
        paths = generate_image_pair_4k(client, dog_prompt, studio_dir)
        
        # Copy white pass as original
        original_path = OUTPUT_DIR / "original.png"
        shutil.copy2(paths["white"], original_path)
        print(f"\n✅ Copied white pass to original.png")
        
        # Apply difference matting
        print("\n[Step 2/3] Applying difference matting...")
        our_result = OUTPUT_DIR / "our-result.png"
        difference_matte(
            Path(paths["white"]),
            Path(paths["black"]),
            our_result
        )
        
        print("\n" + "=" * 60)
        print("SUCCESS! High-quality assets generated:")
        print("=" * 60)
        print(f"  - {original_path}")
        print(f"  - {our_result}")
        print(f"\nStudio files: {studio_dir}")
        print("\n[Step 3/3] Run these next:")
        print("  uv run scripts/landing_page/generate_competitor_result.py")
        print("  uv run scripts/landing_page/generate_zoom_crops.py")
        
    except Exception as e:
        print(f"\n❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
