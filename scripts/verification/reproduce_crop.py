import cv2
import numpy as np
from pathlib import Path
import sys

# Add src to path
sys.path.append(str(Path.cwd()))

from src.celstate.processor import MediaProcessor

def reproduce():
    job_id = "7dca1aca-60e9-4f16-a160-cb2d87449966"
    base_dir = Path(f"jobs/{job_id}/studio")
    white_path = base_dir / f"asset_{job_id.split('-')[0]}_white.png"
    black_path = base_dir / f"asset_{job_id.split('-')[0]}_black.png"
    
    print(f"Loading from: {base_dir}")
    
    img_w = cv2.imread(str(white_path))
    img_b = cv2.imread(str(black_path))
    
    if img_w is None or img_b is None:
        print("Failed to load images")
        return

    img_w = img_w.astype(float)
    img_b = img_b.astype(float)

    # 1. Alpha Recovery
    diff = np.abs(img_w - img_b)
    alpha = 1.0 - (np.mean(diff, axis=2) / 255.0)
    alpha = np.clip(alpha, 0, 1)
    
    print(f"Raw Alpha stats: Min={alpha.min():.4f}, Max={alpha.max():.4f}, Mean={alpha.mean():.4f}")
    
    # Save Raw Alpha
    cv2.imwrite("repro_alpha_raw.png", (alpha * 255).astype(np.uint8))

    processor = MediaProcessor()
    
    # 2. Adaptive Noise Gate (The suspect)
    alpha_gated = processor._apply_adaptive_noise_gate(alpha)
    print(f"Gated Alpha stats: Min={alpha_gated.min():.4f}, Max={alpha_gated.max():.4f}, Mean={alpha_gated.mean():.4f}")
    
    # Check difference
    diff_alpha = np.abs(alpha - alpha_gated)
    print(f"Pixels modified by gate: {np.sum(diff_alpha > 0)}")
    cv2.imwrite("repro_alpha_gated.png", (alpha_gated * 255).astype(np.uint8))
    cv2.imwrite("repro_alpha_diff.png", (diff_alpha * 255).astype(np.uint8))

    # 3. Crop Logic
    # Reconstruct semi-valid RGBA for the crop function
    final_alpha = (alpha_gated * 255).astype(np.uint8)
    # create dummy color
    rgba = cv2.merge([
        np.zeros_like(final_alpha), 
        np.zeros_like(final_alpha), 
        np.zeros_like(final_alpha), 
        final_alpha
    ])
    
    # Trace the crop function
    bbox = processor.analyzer.calculate_visible_bbox(rgba, threshold=10)
    print(f"Calculated BBox with threshold=10: {bbox}")
    
    # Try with lower threshold
    bbox_low = processor.analyzer.calculate_visible_bbox(rgba, threshold=1)
    print(f"Calculated BBox with threshold=1: {bbox_low}")
    
    # Visualize BBox on the raw alpha
    debug_img = cv2.cvtColor((alpha * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
    cv2.rectangle(debug_img, (x, y), (x+w, y+h), (0, 0, 255), 2) # RED = Current
    
    x2, y2, w2, h2 = bbox_low["x"], bbox_low["y"], bbox_low["width"], bbox_low["height"]
    cv2.rectangle(debug_img, (x2, y2), (x2+w2, y2+h2), (0, 255, 0), 2) # GREEN = Strict > 0
    
    cv2.imwrite("repro_crop_debug.png", debug_img)
    print("Saved repro_crop_debug.png")

if __name__ == "__main__":
    reproduce()
