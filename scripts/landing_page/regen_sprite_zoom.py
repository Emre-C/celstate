#!/usr/bin/env python
"""Regenerate zoom crops for sprite assets with better edge detection."""
import cv2
import numpy as np
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "landing_assets_sprite"

def find_interesting_edge_region(rgba, target_size=300):
    alpha = rgba[:, :, 3]
    h, w = alpha.shape
    
    window_size = target_size
    stride = target_size // 4
    
    edge_mask = (alpha > 20) & (alpha < 200)
    
    best_score = 0
    best_pos = (w // 4, h // 4)
    best_stats = {'solid': 0, 'trans': 0, 'edge': 0}
    
    for y in range(0, h - window_size, stride):
        for x in range(0, w - window_size, stride):
            region = edge_mask[y:y + window_size, x:x + window_size]
            edge_score = np.sum(region)
            
            solid_mask = alpha[y:y + window_size, x:x + window_size] > 220
            solid_score = np.sum(solid_mask)
            solid_pct = solid_score / (window_size * window_size)
            
            if solid_pct < 0.20 or solid_pct > 0.85:
                continue
            
            trans_mask = alpha[y:y + window_size, x:x + window_size] < 10
            trans_pct = np.sum(trans_mask) / (window_size * window_size)
            
            if trans_pct > 0.65 or trans_pct < 0.10:
                continue
            
            edge_pct = edge_score / (window_size * window_size)
            if edge_pct < 0.05:
                continue
            
            color_region = rgba[y:y + window_size, x:x + window_size, :3]
            solid_pixels = alpha[y:y + window_size, x:x + window_size] > 200
            if np.any(solid_pixels):
                colors = color_region[solid_pixels]
                color_std = np.std(colors)
                color_bonus = min(color_std / 50.0, 1.5)
            else:
                color_bonus = 1.0
            
            center_y = y + window_size // 2
            center_x = x + window_size // 2
            dist_from_center = np.sqrt(((center_x - w/2)/(w/2))**2 + ((center_y - h/2)/(h/2))**2)
            edge_preference = 1.0 + dist_from_center * 0.3
            
            combined = (edge_score * 0.5 + solid_score * 0.5) * edge_preference * color_bonus
            
            if combined > best_score:
                best_score = combined
                best_pos = (x, y)
                best_stats = {'solid': solid_pct, 'trans': trans_pct, 'edge': edge_pct}
    
    print(f'Best region at ({best_pos[0]}, {best_pos[1]}): solid={best_stats["solid"]*100:.0f}%, trans={best_stats["trans"]*100:.0f}%, edge={best_stats["edge"]*100:.0f}%')
    return (*best_pos, window_size, window_size)

def main():
    our_rgba = cv2.imread(str(OUTPUT_DIR / 'our-result.png'), cv2.IMREAD_UNCHANGED)
    competitor_rgba = cv2.imread(str(OUTPUT_DIR / 'competitor-result.png'), cv2.IMREAD_UNCHANGED)
    
    h, w = our_rgba.shape[:2]
    print(f'Image size: {w}x{h}')
    
    # For sprites that fill the frame, manually pick an edge region
    # Let's try several candidate regions on the perimeter and pick the best
    alpha = our_rgba[:, :, 3]
    
    candidates = [
        # Top edge (cape/head)
        (w//3, 0, 300, 300),
        (w//2 - 150, 0, 300, 300),
        (2*w//3 - 300, 0, 300, 300),
        # Left edge (cape/arm)
        (0, h//3, 300, 300),
        (0, h//2 - 150, 300, 300),
        # Right edge (staff/arm)
        (w - 300, h//3, 300, 300),
        (w - 300, h//2 - 150, 300, 300),
        # Bottom edge (feet/cape)
        (w//3, h - 300, 300, 300),
        (w//2 - 150, h - 300, 300, 300),
    ]
    
    best_candidate = candidates[0]
    best_edge_count = 0
    
    for x, y, cw, ch in candidates:
        region_alpha = alpha[y:y+ch, x:x+cw]
        # Count semi-transparent pixels (edges)
        edge_count = np.sum((region_alpha > 10) & (region_alpha < 245))
        trans_count = np.sum(region_alpha < 10)
        solid_count = np.sum(region_alpha > 245)
        
        total = cw * ch
        edge_pct = edge_count / total * 100
        trans_pct = trans_count / total * 100
        solid_pct = solid_count / total * 100
        
        print(f'  ({x}, {y}): edge={edge_pct:.1f}% trans={trans_pct:.1f}% solid={solid_pct:.1f}%')
        
        # Want mix of solid, transparent, AND edges
        if trans_pct > 5 and solid_pct > 10 and edge_count > best_edge_count:
            best_edge_count = edge_count
            best_candidate = (x, y, cw, ch)
    
    x, y, cw, ch = best_candidate
    print(f'Selected region: ({x}, {y}) - {cw}x{ch}')
    
    our_crop = our_rgba[y:y + ch, x:x + cw]
    competitor_crop = competitor_rgba[y:y + ch, x:x + cw]
    
    zoom_size = 400
    our_zoomed = cv2.resize(our_crop, (zoom_size, zoom_size), interpolation=cv2.INTER_NEAREST)
    competitor_zoomed = cv2.resize(competitor_crop, (zoom_size, zoom_size), interpolation=cv2.INTER_NEAREST)
    
    cv2.imwrite(str(OUTPUT_DIR / 'zoom-ours.png'), our_zoomed)
    cv2.imwrite(str(OUTPUT_DIR / 'zoom-competitor.png'), competitor_zoomed)
    
    print(f'✅ Saved zoom-ours.png and zoom-competitor.png')

if __name__ == '__main__':
    main()
