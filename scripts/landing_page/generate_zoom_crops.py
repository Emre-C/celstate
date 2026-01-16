#!/usr/bin/env python
"""
Generate 4x zoomed crops of fur edges for comparison.

Creates:
- zoom-ours.png (400x400) - Cropped from our-result.png
- zoom-competitor.png (400x400) - Cropped from competitor-result.png

The crops focus on fur-heavy edge areas where artifacts are most visible.

Usage:
    uv run scripts/landing_page/generate_zoom_crops.py
"""

import sys
from pathlib import Path

import cv2
import numpy as np

# Project paths
project_root = Path(__file__).parent.parent.parent
OUTPUT_DIR = project_root / "landing_assets"


def find_interesting_edge_region(rgba: np.ndarray, target_size: int = 200) -> tuple:
    """
    Find a region with interesting semi-transparent edges (fluffy fur).
    Returns (x, y, w, h) of the crop region (at 1x scale).
    
    Prefers upper/middle regions where fur is typically most prominent,
    and darker fur areas for better edge visibility contrast.
    """
    alpha = rgba[:, :, 3]
    h, w = alpha.shape
    
    # For high-res images, use larger crop window
    # Scale target_size based on image size
    if max(h, w) > 2000:
        target_size = 250  # Larger crop for high-res
    
    # Look for regions with lots of semi-transparent pixels (edges/fur)
    # Fine fur strands typically have alpha values in the 30-200 range
    edge_mask = (alpha > 20) & (alpha < 200)
    
    # Use a sliding window to find the best edge region
    best_score = 0
    best_pos = (w // 4, h // 4)  # Default to upper-left quadrant
    
    window_size = target_size
    stride = target_size // 4
    
    for y in range(0, h - window_size, stride):
        for x in range(0, w - window_size, stride):
            region = edge_mask[y:y + window_size, x:x + window_size]
            edge_score = np.sum(region)
            
            # Prefer regions that also have some solid content (not just edges)
            solid_mask = alpha[y:y + window_size, x:x + window_size] > 220
            solid_score = np.sum(solid_mask)
            
            # Avoid regions with too much transparency (mostly background)
            trans_mask = alpha[y:y + window_size, x:x + window_size] < 10
            trans_pct = np.sum(trans_mask) / (window_size * window_size)
            
            # Skip if >60% is fully transparent (we want to see the edge)
            if trans_pct > 0.6:
                continue
                
            # Skip if <10% transparent (no interesting edge visible)
            if trans_pct < 0.1:
                continue
            
            # Calculate fur darkness - prefer darker fur for better contrast
            # This helps avoid washed-out white belly/chest regions
            color_region = rgba[y:y + window_size, x:x + window_size, :3]
            solid_pixels = alpha[y:y + window_size, x:x + window_size] > 200
            if np.any(solid_pixels):
                avg_brightness = np.mean(color_region[solid_pixels])
                # Prefer mid-tones (100-180 brightness) over white fur
                if avg_brightness < 100:
                    darkness_bonus = 1.0  # Dark fur
                elif avg_brightness < 180:
                    darkness_bonus = 1.3  # Orange/tan fur (ideal)
                else:
                    darkness_bonus = 0.7  # White/cream fur (less ideal)
            else:
                darkness_bonus = 1.0
            
            # Prefer upper half of image (fluffy chest/shoulder fur)
            # Apply a multiplier that decreases as y increases
            vertical_preference = 1.0 + (1.0 - y / h) * 0.5  # 1.5x at top, 1.0x at bottom
            
            # Prefer edges on the sides (left or right 40% of the image)
            # This is where fur typically extends outward
            center_x = x + window_size // 2
            x_distance_from_center = abs(center_x - w // 2) / (w // 2)
            horizontal_preference = 1.0 + x_distance_from_center * 0.3  # 1.3x at edges
            
            # Combined score: edge density, some solid content, positional preference, darkness bonus
            combined = (edge_score * 0.6 + solid_score * 0.4) * vertical_preference * horizontal_preference * darkness_bonus
            
            if combined > best_score:
                best_score = combined
                best_pos = (x, y)
    
    return (*best_pos, window_size, window_size)


def create_zoom_crop(input_path: Path, output_path: Path, output_size: int = 400):
    """
    Create a 4x zoomed crop focusing on an edge-heavy region.
    """
    print(f"Loading: {input_path}")
    
    rgba = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if rgba is None:
        raise ValueError(f"Could not load image: {input_path}")
    
    h, w = rgba.shape[:2]
    print(f"  Size: {w}x{h}")
    
    # Calculate crop size (1/4 of output size for 4x zoom)
    crop_size = output_size // 4
    
    # Find interesting edge region
    x, y, cw, ch = find_interesting_edge_region(rgba, target_size=crop_size)
    print(f"  Cropping region: ({x}, {y}) - {cw}x{ch}")
    
    # Extract crop
    crop = rgba[y:y + ch, x:x + cw]
    
    # Upscale 4x using NEAREST neighbor to preserve artifacts clearly
    # (INTER_NEAREST shows the raw pixels without smoothing)
    zoomed = cv2.resize(crop, (output_size, output_size), interpolation=cv2.INTER_NEAREST)
    
    # Save
    cv2.imwrite(str(output_path), zoomed)
    print(f"  ✅ Saved: {output_path}")
    
    return x, y, cw, ch


def main():
    print("=" * 60)
    print("Generating Zoom Crops for Comparison")
    print("=" * 60)
    
    our_result = OUTPUT_DIR / "our-result.png"
    competitor_result = OUTPUT_DIR / "competitor-result.png"
    
    # Check inputs exist
    if not our_result.exists():
        print(f"\n❌ ERROR: {our_result} not found!")
        print("Please run generate_landing_assets.py first.")
        return 1
    
    if not competitor_result.exists():
        print(f"\n❌ ERROR: {competitor_result} not found!")
        print("Please run generate_competitor_result.py first.")
        return 1
    
    try:
        # Generate zoom from our result first to get the crop region
        print("\n[1/2] Creating zoom-ours.png...")
        zoom_ours = OUTPUT_DIR / "zoom-ours.png"
        crop_region = create_zoom_crop(our_result, zoom_ours, output_size=400)
        
        # Use the SAME crop region for competitor for fair comparison
        print("\n[2/2] Creating zoom-competitor.png (same region)...")
        zoom_competitor = OUTPUT_DIR / "zoom-competitor.png"
        
        # Load competitor and apply same crop
        competitor_rgba = cv2.imread(str(competitor_result), cv2.IMREAD_UNCHANGED)
        x, y, cw, ch = crop_region
        crop = competitor_rgba[y:y + ch, x:x + cw]
        zoomed = cv2.resize(crop, (400, 400), interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(zoom_competitor), zoomed)
        print(f"  ✅ Saved: {zoom_competitor}")
        
        print("\n" + "=" * 60)
        print("SUCCESS! All assets generated:")
        print("=" * 60)
        
        for f in ["original.png", "our-result.png", "competitor-result.png", 
                  "zoom-ours.png", "zoom-competitor.png"]:
            path = OUTPUT_DIR / f
            if path.exists():
                size = path.stat().st_size
                print(f"  ✅ {f} ({size / 1024:.1f} KB)")
            else:
                print(f"  ❌ {f} (missing)")
        
        print(f"\nAll assets in: {OUTPUT_DIR}")
        
    except Exception as e:
        print(f"\n❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
