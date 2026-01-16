#!/usr/bin/env python
"""
Generate video game sprite assets for landing page comparison.

Creates a cool sprite character with:
1. original.png - Sprite on a COMPLEX background (forest, dungeon, etc.)
2. our-result.png - Sprite with perfect transparency
3. competitor-result.png - Sprite with artifacts (via crappy removal simulation)

This demonstrates removing complex backgrounds, not just solid colors!

Usage:
    uv run scripts/landing_page/generate_sprite_assets.py
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

OUTPUT_DIR = project_root / "landing_assets_sprite"

# Model configuration - Gemini 3 Pro Image for 4K quality
MODEL_ID = "gemini-3-pro-image-preview"
RESOLUTION = "4K"  # Must be uppercase: "1K", "2K", or "4K"
ASPECT_RATIO = "1:1"  # Square for sprite


def init_client():
    """Initialize Vertex AI client with GLOBAL endpoint."""
    vertex_project = os.environ.get("VERTEX_PROJECT_ID")
    
    if not vertex_project:
        raise ValueError("VERTEX_PROJECT_ID must be set in environment")
    
    return genai.Client(
        vertexai=True,
        project=vertex_project,
        location="global"
    )


def generate_image(client, prompt: str, name: str, output_dir: Path, aspect_ratio: str = "1:1") -> tuple:
    """
    Generate a high-quality image using Gemini 3 Pro Image.
    
    Returns (path, image_bytes) tuple.
    """
    print(f"  Generating with {MODEL_ID} at {RESOLUTION} resolution...")
    
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio=aspect_ratio,
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
            image_bytes = part.inline_data.data
            image = Image.open(io.BytesIO(image_bytes))
            output_path = output_dir / f"{name}.png"
            image.save(str(output_path))
            print(f"  ✅ Saved: {output_path} ({image.size[0]}x{image.size[1]})")
            return output_path, image_bytes
    
    raise RuntimeError("No image data returned from API")


def edit_image(client, image_bytes: bytes, edit_prompt: str, name: str, output_dir: Path) -> tuple:
    """
    Edit an existing image using Gemini 3 Pro Image.
    
    Returns (path, image_bytes) tuple.
    """
    print(f"  Editing with {MODEL_ID}...")
    
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")
    
    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            image_size=RESOLUTION,
        ),
    )
    
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=[edit_prompt, image_part],
        config=config,
    )
    
    # Extract image from response
    for part in response.parts:
        if part.inline_data is not None:
            result_bytes = part.inline_data.data
            image = Image.open(io.BytesIO(result_bytes))
            output_path = output_dir / f"{name}.png"
            image.save(str(output_path))
            print(f"  ✅ Saved: {output_path} ({image.size[0]}x{image.size[1]})")
            return output_path, result_bytes
    
    raise RuntimeError("No image data returned from API")


def difference_matte(white_path: Path, black_path: Path, output_path: Path):
    """
    Apply difference matting to extract transparency.
    """
    print("\n  Processing with difference matting...")
    
    img_w = cv2.imread(str(white_path))
    img_b = cv2.imread(str(black_path))
    
    if img_w is None or img_b is None:
        raise ValueError(f"Could not read input images")
    
    # Handle size mismatch
    if img_w.shape != img_b.shape:
        print(f"  ⚠️  Size mismatch: white={img_w.shape}, black={img_b.shape}")
        # Resize black to match white using high-quality interpolation
        img_b = cv2.resize(img_b, (img_w.shape[1], img_w.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    
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


def generate_competitor_result(input_path: Path, output_path: Path):
    """Apply 'crappy' background removal artifacts to a perfect result."""
    
    print(f"  Loading: {input_path}")
    
    rgba = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if rgba is None:
        raise ValueError(f"Could not load image: {input_path}")
    
    if rgba.shape[2] != 4:
        raise ValueError(f"Image must have alpha channel: {input_path}")
    
    print(f"  Original size: {rgba.shape[1]}x{rgba.shape[0]}")
    
    alpha = rgba[:, :, 3].astype(float) / 255.0
    
    # 1. Add white halo around edges
    print("  Applying white halo...")
    edge_mask = (alpha > 0.1) & (alpha < 0.9)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    halo_region = cv2.dilate(edge_mask.astype(np.uint8), kernel, iterations=1)
    halo_region = (halo_region > 0) & ~(alpha > 0.95)
    
    result = rgba.copy().astype(float)
    blend_factor = 0.5 * (1 - alpha)[:, :, np.newaxis]
    
    for c in range(3):
        result[:, :, c] = np.where(
            halo_region,
            result[:, :, c] * (1 - blend_factor[:, :, 0]) + 255 * blend_factor[:, :, 0],
            result[:, :, c]
        )
    
    # 2. Erode fine details
    print("  Eroding fine details...")
    alpha_uint8 = rgba[:, :, 3]
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    alpha_eroded = cv2.erode(alpha_uint8, kernel, iterations=1)
    alpha_blurred = cv2.GaussianBlur(alpha_eroded, (3, 3), sigmaX=0.8)
    result[:, :, 3] = alpha_blurred
    
    # 3. Add edge jagginess
    print("  Adding edge jagginess...")
    alpha_new = result[:, :, 3].astype(float) / 255.0
    levels = 8
    alpha_quantized = np.round(alpha_new * levels) / levels
    factor = 0.35
    alpha_jagged = alpha_new * (1 - factor) + alpha_quantized * factor
    result[:, :, 3] = (alpha_jagged * 255).astype(np.uint8)
    
    # 4. Add color fringing
    print("  Adding color fringing...")
    alpha_final = result[:, :, 3].astype(float) / 255.0
    fringe_mask = (alpha_final > 0.1) & (alpha_final < 0.7)
    fringe_color = (220, 220, 220)
    strength = 0.35
    
    for c in range(3):
        result[:, :, c] = np.where(
            fringe_mask,
            result[:, :, c] * (1 - strength * (1 - alpha_final)) + fringe_color[c] * strength * (1 - alpha_final),
            result[:, :, c]
        )
    
    result = np.clip(result, 0, 255).astype(np.uint8)
    cv2.imwrite(str(output_path), result)
    print(f"  ✅ Saved: {output_path}")


def find_interesting_edge_region(rgba: np.ndarray, target_size: int = 200) -> tuple:
    """Find a region with interesting semi-transparent edges for sprites."""
    alpha = rgba[:, :, 3]
    h, w = alpha.shape
    
    if max(h, w) > 2000:
        target_size = 300  # Larger for 4K images
    
    edge_mask = (alpha > 20) & (alpha < 200)
    
    best_score = 0
    best_pos = (w // 4, h // 4)
    
    window_size = target_size
    stride = target_size // 4
    
    for y in range(0, h - window_size, stride):
        for x in range(0, w - window_size, stride):
            region = edge_mask[y:y + window_size, x:x + window_size]
            edge_score = np.sum(region)
            
            # REQUIRE enough solid (opaque) content - at least 20% of the window
            solid_mask = alpha[y:y + window_size, x:x + window_size] > 220
            solid_score = np.sum(solid_mask)
            solid_pct = solid_score / (window_size * window_size)
            
            # Skip if too little solid content (< 20%)
            if solid_pct < 0.20:
                continue
                
            # Skip if too much solid (no edge to see)
            if solid_pct > 0.85:
                continue
            
            trans_mask = alpha[y:y + window_size, x:x + window_size] < 10
            trans_pct = np.sum(trans_mask) / (window_size * window_size)
            
            # Need some transparency (10-60%) to show the edge
            if trans_pct > 0.65 or trans_pct < 0.10:
                continue
            
            # Edge pixels should be reasonable amount (at least 5% of window)
            edge_pct = edge_score / (window_size * window_size)
            if edge_pct < 0.05:
                continue
            
            # Prefer colorful/interesting regions
            color_region = rgba[y:y + window_size, x:x + window_size, :3]
            solid_pixels = alpha[y:y + window_size, x:x + window_size] > 200
            if np.any(solid_pixels):
                # Calculate color variance - prefer varied, interesting colors
                colors = color_region[solid_pixels]
                color_std = np.std(colors)
                color_bonus = min(color_std / 50.0, 1.5)  # Cap at 1.5x
            else:
                color_bonus = 1.0
            
            # Prefer outer edges where capes/weapons/effects are
            center_y = y + window_size // 2
            center_x = x + window_size // 2
            
            # Distance from center (normalized)
            dist_from_center = np.sqrt(((center_x - w/2)/(w/2))**2 + ((center_y - h/2)/(h/2))**2)
            edge_preference = 1.0 + dist_from_center * 0.3
            
            # Combined score
            combined = (edge_score * 0.5 + solid_score * 0.5) * edge_preference * color_bonus
            
            if combined > best_score:
                best_score = combined
                best_pos = (x, y)
    
    print(f"  Best region - solid: {solid_pct*100:.0f}%, trans: {trans_pct*100:.0f}%, edge: {edge_pct*100:.0f}%")
    return (*best_pos, window_size, window_size)


def generate_zoom_crops(our_result_path: Path, competitor_result_path: Path, output_dir: Path):
    """Generate zoom crops from both results."""
    print("\n  Generating zoom crops...")
    
    our_rgba = cv2.imread(str(our_result_path), cv2.IMREAD_UNCHANGED)
    competitor_rgba = cv2.imread(str(competitor_result_path), cv2.IMREAD_UNCHANGED)
    
    x, y, cw, ch = find_interesting_edge_region(our_rgba)
    print(f"  Cropping region: ({x}, {y}) - {cw}x{ch}")
    
    # Crop and zoom both images from same region
    our_crop = our_rgba[y:y + ch, x:x + cw]
    competitor_crop = competitor_rgba[y:y + ch, x:x + cw]
    
    # 4x zoom using nearest neighbor to show pixels clearly
    zoom_size = 400
    our_zoomed = cv2.resize(our_crop, (zoom_size, zoom_size), interpolation=cv2.INTER_NEAREST)
    competitor_zoomed = cv2.resize(competitor_crop, (zoom_size, zoom_size), interpolation=cv2.INTER_NEAREST)
    
    zoom_ours_path = output_dir / "zoom-ours.png"
    zoom_competitor_path = output_dir / "zoom-competitor.png"
    
    cv2.imwrite(str(zoom_ours_path), our_zoomed)
    cv2.imwrite(str(zoom_competitor_path), competitor_zoomed)
    
    print(f"  ✅ Saved: {zoom_ours_path}")
    print(f"  ✅ Saved: {zoom_competitor_path}")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    studio_dir = OUTPUT_DIR / "studio"
    studio_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 70)
    print("Generating VIDEO GAME SPRITE Assets for Landing Page")
    print(f"Model: {MODEL_ID}")
    print(f"Resolution: {RESOLUTION}")
    print("=" * 70)
    
    try:
        client = init_client()
        print("✅ Vertex AI client initialized\n")
    except Exception as e:
        print(f"❌ Failed to initialize client: {e}")
        return 1
    
    # Define the sprite character
    sprite_description = (
        "A powerful warrior mage character, full body standing pose, "
        "wearing ornate silver and purple armor with glowing magical runes, "
        "long flowing cape with intricate patterns, "
        "wielding a staff topped with a glowing crystal orb, "
        "detailed fantasy RPG game character design, "
        "highly detailed digital art, video game sprite style"
    )
    
    try:
        # ============================================================
        # STEP 1: Generate original with COMPLEX BACKGROUND
        # ============================================================
        print("[Step 1/5] Generating original with complex background...")
        print(f"  Sprite: {sprite_description[:60]}...")
        
        original_prompt = (
            f"{sprite_description}\n\n"
            "BACKGROUND: The character is standing in an enchanted forest at twilight, "
            "with magical glowing mushrooms, ancient twisted trees, floating particles of light, "
            "fog rolling along the forest floor, dappled mystical lighting filtering through leaves. "
            "Rich, detailed fantasy environment. Atmospheric and immersive."
        )
        
        original_path, original_bytes = generate_image(
            client, original_prompt, "original", OUTPUT_DIR
        )
        
        # ============================================================
        # STEP 2: Generate white pass (same sprite, white background)
        # ============================================================
        print("\n[Step 2/5] Generating white background pass...")
        
        white_prompt = (
            f"{sprite_description}\n\n"
            "BACKGROUND: Solid pure white (#FFFFFF). No gradient. No shadows on background. "
            "Professional studio lighting. Character centered with padding."
        )
        
        white_path, white_bytes = generate_image(
            client, white_prompt, "sprite_white", studio_dir
        )
        
        # ============================================================
        # STEP 3: Generate black pass (edit white to black background)
        # ============================================================
        print("\n[Step 3/5] Editing to black background...")
        
        black_edit_prompt = (
            "Strictly change ALL background from White to solid Pure Black (#000000). "
            "Keep the character EXACTLY the same - same pose, same details, same colors. "
            "CRITICAL: Do not crop, zoom, or shift. Character must match pixel-for-pixel."
        )
        
        black_path, black_bytes = edit_image(
            client, white_bytes, black_edit_prompt, "sprite_black", studio_dir
        )
        
        # ============================================================
        # STEP 4: Apply difference matting for perfect transparency
        # ============================================================
        print("\n[Step 4/5] Applying difference matting...")
        
        our_result_path = OUTPUT_DIR / "our-result.png"
        difference_matte(white_path, black_path, our_result_path)
        
        # ============================================================
        # STEP 5: Generate competitor result with artifacts
        # ============================================================
        print("\n[Step 5/5] Generating competitor result with artifacts...")
        
        competitor_result_path = OUTPUT_DIR / "competitor-result.png"
        generate_competitor_result(our_result_path, competitor_result_path)
        
        # ============================================================
        # BONUS: Generate zoom crops
        # ============================================================
        print("\n[Bonus] Generating zoom crops...")
        generate_zoom_crops(our_result_path, competitor_result_path, OUTPUT_DIR)
        
        # ============================================================
        # Summary
        # ============================================================
        print("\n" + "=" * 70)
        print("SUCCESS! All sprite assets generated:")
        print("=" * 70)
        
        for f in ["original.png", "our-result.png", "competitor-result.png", 
                  "zoom-ours.png", "zoom-competitor.png"]:
            path = OUTPUT_DIR / f
            if path.exists():
                size = path.stat().st_size / 1024
                print(f"  ✅ {f} ({size:.1f} KB)")
            else:
                print(f"  ❌ {f} (missing)")
        
        print(f"\nStudio files in: {studio_dir}")
        print(f"All assets in: {OUTPUT_DIR}")
        
    except Exception as e:
        print(f"\n❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
