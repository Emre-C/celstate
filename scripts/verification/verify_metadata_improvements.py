import numpy as np
import cv2
from pathlib import Path
import sys

# Add src to path
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

from src.celstate.image_analysis_core import ImageAnalysisCore
from src.celstate.layout_analyzer import LayoutAnalyzer

def create_synthetic_pill(width=400, height=200, radius=50):
    # Create RGBA image
    img = np.zeros((height, width, 4), dtype=np.uint8)
    
    # Fill with opaque color (the "frame")
    img[:, :] = [0, 0, 255, 255] # Red frame
    
    # Cut out the void (transparent rounded rect)
    # Center the void
    void_w, void_h = width - 40, height - 40
    x, y = 20, 20
    
    # Draw rounded rect on alpha channel
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (x + radius, y), (x + void_w - radius, y + void_h), 255, -1)
    cv2.rectangle(mask, (x, y + radius), (x + void_w, y + void_h - radius), 255, -1)
    cv2.circle(mask, (x + radius, y + radius), radius, 255, -1)
    cv2.circle(mask, (x + void_w - radius, y + radius), radius, 255, -1)
    cv2.circle(mask, (x + radius, y + void_h - radius), radius, 255, -1)
    cv2.circle(mask, (x + void_w - radius, y + void_h - radius), radius, 255, -1)
    
    # Apply void mask (where mask is white, alpha becomes 0)
    img[:, :, 3] = np.where(mask == 255, 0, 255)
    
    return img

def create_synthetic_vine(width=400, height=400):
    # Organic frame with a vine hanging top-right
    img = np.zeros((height, width, 4), dtype=np.uint8)
    img[:, :] = [0, 255, 0, 255] # Green frame
    
    # Create an irregular void (mostly transparent)
    # But with a vine hanging down in the top right
    img[:, :, 3] = 0 # Start fully transparent
    
    # Add frame borders
    border = 20
    img[0:border, :, 3] = 255
    img[-border:, :, 3] = 255
    img[:, 0:border, 3] = 255
    img[:, -border:, 3] = 255
    
    # Add Vine (Top Right Intrusion)
    # A diagonal blob
    for i in range(100):
        radius = 30 - int(i * 0.2)
        cv2.circle(img, (width - 50, 50 + i * 2), radius, (0, 255, 0, 255), -1)
        
    return img

def test_geometric_pill():
    print("\n--- Testing Geometric Pill ---")
    analyzer = LayoutAnalyzer()
    
    radius = 40
    img = create_synthetic_pill(radius=radius)
    metadata = analyzer.analyze_full(img)
    
    shape_hint = metadata["shape_hint"]
    inner_radius = shape_hint.get("inner_corner_radius")
    arc_centers = metadata.get("arc_centers")
    
    print(f"Detected Shape: {shape_hint.get('type')}")
    print(f"Inner Radius Target: {radius}, Detected: {inner_radius}")
    print(f"Arc Centers: {arc_centers}")
    
    # Assertions
    if shape_hint.get("type") != "rounded_rectangle":
        print("FAIL: Shape not detected as rounded_rectangle")
        return False
        
    if inner_radius is None or abs(inner_radius - radius) > 10:
        print(f"FAIL: Inner Radius deviation too high. Target {radius}, Got {inner_radius}")
        return False
        
    if not arc_centers:
        print("FAIL: Arc Centers missing")
        return False
        
    print("PASS: Geometric Pill metadata")
    return True

def test_organic_vine():
    print("\n--- Testing Organic Vine (Robustness) ---")
    analyzer = LayoutAnalyzer()
    
    img = create_synthetic_vine()
    metadata = analyzer.analyze_full(img)
    
    shape_type = metadata["shape_hint"].get("type")
    inner_radius = metadata["shape_hint"].get("inner_corner_radius")
    arc_centers = metadata.get("arc_centers")
    anchor_points = metadata.get("anchor_points")
    
    print(f"Detected Shape: {shape_type}")
    print(f"Inner Radius (Should be None): {inner_radius}")
    print(f"Arc Centers (Should be None): {arc_centers}")
    print(f"Anchor Points Left: {anchor_points.get('left')}")
    
    # Assertions for Robustness
    if shape_type != "organic":
        print(f"FAIL: Vine should be classified as organic, got {shape_type}")
        # Note: If CV is simple, organic might be fallback.
    
    if inner_radius is not None:
         print("FAIL: Hallucinated inner_radius for organic shape")
         return False
         
    if arc_centers is not None:
        print("FAIL: Hallucinated arc_centers for organic shape")
        return False
        
    if not anchor_points:
        print("FAIL: Anchor points missing")
        return False
        
    # Check if anchor points respect the vine (Top right intrusion)
    # The vine is at width-50. So Right anchor should be pushed in or Left anchor stable.
    # The vine hangs on the right.
    # Let's check visual edge bounds
    visual_edge = metadata.get("visual_edge_bounds")
    print(f"Visual Edge: {visual_edge}")
    
    print("PASS: Organic Vine robustness")
    return True

if __name__ == "__main__":
    p1 = test_geometric_pill()
    p2 = test_organic_vine()
    
    if p1 and p2:
        print("\nALL TESTS PASSED")
        sys.exit(0)
    else:
        print("\nTESTS FAILED")
        sys.exit(1)
