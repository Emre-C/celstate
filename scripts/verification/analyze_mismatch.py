import cv2
import numpy as np
from pathlib import Path
import sys

def analyze():
    job_id = "7dca1aca-60e9-4f16-a160-cb2d87449966"
    base_dir = Path(f"jobs/{job_id}/studio")
    white_path = base_dir / f"asset_{job_id.split('-')[0]}_white.png"
    black_path = base_dir / f"asset_{job_id.split('-')[0]}_black.png"
    
    img_w = cv2.imread(str(white_path))
    img_b = cv2.imread(str(black_path))
    
    if img_w is None or img_b is None:
        print("Failed to load images")
        return

    # Helper to find bbox
    def get_bbox(img, bg_color):
        # Euclidean distance from bg color
        diff = np.linalg.norm(img.astype(float) - bg_color, axis=2)
        # Threshold > 10 is content
        rows = np.any(diff > 10, axis=1)
        cols = np.any(diff > 10, axis=0)
        
        if not np.any(rows) or not np.any(cols):
            return 0, 0, 0, 0
            
        y_min, y_max = np.where(rows)[0][[0, -1]]
        x_min, x_max = np.where(cols)[0][[0, -1]]
        
        return x_min, y_min, x_max - x_min, y_max - y_min

    # White Pass (Background is White [255, 255, 255])
    wx, wy, ww, wh = get_bbox(img_w, np.array([255, 255, 255]))
    print(f"White Pass Content: x={wx}, y={wy}, w={ww}, h={wh}")

    # Black Pass (Background is Black [0, 0, 0])
    bx, by, bw, bh = get_bbox(img_b, np.array([0, 0, 0]))
    print(f"Black Pass Content: x={bx}, y={by}, w={bw}, h={bh}")

    # Check Intersection Over Union (IoU)
    # Intersection
    ix1 = max(wx, bx)
    iy1 = max(wy, by)
    ix2 = min(wx+ww, bx+bw)
    iy2 = min(wy+wh, by+bh)
    
    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    
    intersection = iw * ih
    union = (ww * wh) + (bw * bh) - intersection
    
    iou = intersection / union if union > 0 else 0
    print(f"BBox IoU: {iou:.4f}")
    
    if iou < 0.95:
        print("MISMATCH DETECTED: The model likely hallucinated different crops/zooms.")
    else:
        print("Alignment looks okay structurally.")

    # Visualize
    debug = img_w.copy()
    cv2.rectangle(debug, (wx, wy), (wx+ww, wy+wh), (0, 0, 255), 2) # Red = White Pass
    cv2.rectangle(debug, (bx, by), (bx+bw, by+bh), (0, 255, 0), 2) # Green = Black Pass
    cv2.imwrite("repro_mismatch_debug.png", debug)
    print("Saved repro_mismatch_debug.png")

if __name__ == "__main__":
    analyze()
