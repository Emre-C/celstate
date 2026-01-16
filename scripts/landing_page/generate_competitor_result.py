#!/usr/bin/env python
"""
Generate "competitor" result with intentional artifacts.

This script simulates a naive background removal algorithm that produces:
- White/light halo around fur edges
- Jaggy edges on curved areas
- Some fringing where fine hairs meet transparency

Uses simple thresholding and morphological operations to create
a plausibly "real" but inferior result compared to our difference matting.

Usage:
    uv run scripts/landing_page/generate_competitor_result.py
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Project paths
project_root = Path(__file__).parent.parent.parent
OUTPUT_DIR = project_root / "landing_assets"


def add_white_halo(rgba: np.ndarray, halo_px: int = 3, strength: float = 0.5) -> np.ndarray:
    """Add a white halo around semi-transparent edges."""
    alpha = rgba[:, :, 3].astype(float) / 255.0
    
    # Find edge regions (semi-transparent areas on the boundary)
    edge_mask = (alpha > 0.1) & (alpha < 0.9)
    
    # Dilate to create halo region
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (halo_px * 2 + 1, halo_px * 2 + 1))
    halo_region = cv2.dilate(edge_mask.astype(np.uint8), kernel, iterations=1)
    halo_region = (halo_region > 0) & ~(alpha > 0.95)  # Don't affect solid areas
    
    # Blend white into halo region
    result = rgba.copy().astype(float)
    blend_factor = strength * (1 - alpha)[:, :, np.newaxis]
    
    for c in range(3):  # RGB
        result[:, :, c] = np.where(
            halo_region,
            result[:, :, c] * (1 - blend_factor[:, :, 0]) + 255 * blend_factor[:, :, 0],
            result[:, :, c]
        )
    
    return np.clip(result, 0, 255).astype(np.uint8)


def add_edge_jagginess(rgba: np.ndarray, factor: float = 0.3) -> np.ndarray:
    """Make edges more jaggy by quantizing the alpha channel."""
    alpha = rgba[:, :, 3].astype(float) / 255.0
    
    # Quantize alpha to fewer levels (creates stair-stepping)
    levels = 8  # Instead of 256 continuous levels
    alpha_quantized = np.round(alpha * levels) / levels
    
    # Blend original with quantized based on factor
    alpha_jagged = alpha * (1 - factor) + alpha_quantized * factor
    
    result = rgba.copy()
    result[:, :, 3] = (alpha_jagged * 255).astype(np.uint8)
    return result


def erode_alpha_slightly(rgba: np.ndarray, erosion_px: int = 1) -> np.ndarray:
    """Slightly erode alpha to lose fine hair details."""
    alpha = rgba[:, :, 3]
    
    # Erode to lose fine strands
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erosion_px * 2 + 1, erosion_px * 2 + 1))
    alpha_eroded = cv2.erode(alpha, kernel, iterations=1)
    
    # Also apply slight blur to remove crisp edges
    alpha_blurred = cv2.GaussianBlur(alpha_eroded, (3, 3), sigmaX=0.8)
    
    result = rgba.copy()
    result[:, :, 3] = alpha_blurred
    return result


def add_fringing(rgba: np.ndarray, fringe_color: tuple = (220, 220, 220), strength: float = 0.4) -> np.ndarray:
    """Add color fringing at semi-transparent edges."""
    alpha = rgba[:, :, 3].astype(float) / 255.0
    
    # Target semi-transparent pixels
    fringe_mask = (alpha > 0.1) & (alpha < 0.7)
    
    result = rgba.copy().astype(float)
    
    for c in range(3):
        result[:, :, c] = np.where(
            fringe_mask,
            result[:, :, c] * (1 - strength * (1 - alpha)) + fringe_color[c] * strength * (1 - alpha),
            result[:, :, c]
        )
    
    return np.clip(result, 0, 255).astype(np.uint8)


def generate_competitor_result(input_path: Path, output_path: Path):
    """Apply 'crappy' background removal artifacts to a perfect result."""
    
    print(f"Loading: {input_path}")
    
    # Load the perfect result
    rgba = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if rgba is None:
        raise ValueError(f"Could not load image: {input_path}")
    
    if rgba.shape[2] != 4:
        raise ValueError(f"Image must have alpha channel: {input_path}")
    
    print(f"  Original size: {rgba.shape[1]}x{rgba.shape[0]}")
    
    # Apply degradations in sequence
    print("  Applying white halo...")
    rgba = add_white_halo(rgba, halo_px=4, strength=0.6)
    
    print("  Eroding fine details...")
    rgba = erode_alpha_slightly(rgba, erosion_px=1)
    
    print("  Adding edge jagginess...")
    rgba = add_edge_jagginess(rgba, factor=0.35)
    
    print("  Adding color fringing...")
    rgba = add_fringing(rgba, fringe_color=(230, 230, 230), strength=0.35)
    
    # Save result
    cv2.imwrite(str(output_path), rgba)
    print(f"  ✅ Saved: {output_path}")
    
    return output_path


def main():
    print("=" * 60)
    print("Generating Competitor Result (with artifacts)")
    print("=" * 60)
    
    # Input: our perfect result
    our_result = OUTPUT_DIR / "our-result.png"
    
    if not our_result.exists():
        print(f"\n❌ ERROR: {our_result} not found!")
        print("Please run generate_landing_assets.py first.")
        return 1
    
    # Output: competitor result
    competitor_result = OUTPUT_DIR / "competitor-result.png"
    
    try:
        generate_competitor_result(our_result, competitor_result)
        
        print("\n" + "=" * 60)
        print("SUCCESS!")
        print("=" * 60)
        print(f"\nGenerated: {competitor_result}")
        print("\nArtifacts applied:")
        print("  - White halo around edges")
        print("  - Fine fur details eroded")
        print("  - Jaggy quantized edges")
        print("  - Light color fringing")
        print("\nNext: Run generate_zoom_crops.py to create zoomed comparisons")
        
    except Exception as e:
        print(f"\n❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
