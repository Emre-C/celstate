import numpy as np
from src.engine.core.analyzer import LayoutAnalyzer

def test_calculate_visible_bbox():
    analyzer = LayoutAnalyzer()
    
    # Create a 100x100 transparent image
    img = np.zeros((100, 100, 4), dtype=np.uint8)
    
    # 1. Add "Visible" Content (Opaque red square in center)
    # 20x20 square at (40,40) to (60,60)
    img[40:60, 40:60] = [255, 0, 0, 255]
    
    # 2. Add "Noise" / "Faint Glow" (Alpha < 10)
    # Pixels at corners with alpha=5 (should be IGNORED by threshold=10)
    img[0:10, 0:10] = [255, 255, 255, 9]   # Top-left noise
    img[90:100, 90:100] = [255, 255, 255, 10] # Bottom-right noise (exactly 10 should be ignored if >10)
    
    # Pixel with alpha=11 (should be INCLUDED)
    # Let's put a "whisper" detail right next to the box
    img[39, 40] = [255, 255, 255, 11]
    
    # Calculate BBox
    bbox = analyzer.calculate_visible_bbox(img, threshold=10)
    
    print(f"Calculated BBox: {bbox}")
    
    # Expected:
    # Main content: y=40..59 (height 20), x=40..59 (width 20)
    # + Whisper detail: y=39
    # NOISE (alpha<=10) should be ignored.
    
    expected_y_min = 39 # Because of the alpha=11 pixel
    expected_y_max = 59
    expected_x_min = 40
    expected_x_max = 59
    
    expected_w = expected_x_max - expected_x_min + 1
    expected_h = expected_y_max - expected_y_min + 1
    
    assert bbox["x"] == expected_x_min, f"Expected x={expected_x_min}, got {bbox['x']}"
    assert bbox["y"] == expected_y_min, f"Expected y={expected_y_min}, got {bbox['y']}"
    assert bbox["width"] == expected_w, f"Expected w={expected_w}, got {bbox['width']}"
    assert bbox["height"] == expected_h, f"Expected h={expected_h}, got {bbox['height']}"
    
    print("✅ test_calculate_visible_bbox passed!")

if __name__ == "__main__":
    test_calculate_visible_bbox()
