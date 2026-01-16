import cv2
import json
import numpy as np
import sys
import os

# Add src to path
sys.path.append(os.getcwd())

from src.celstate.layout_analyzer import LayoutAnalyzer

def analyze(path):
    print(f"Analyzing {path}...")
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        print("Failed to load image")
        return

    analyzer = LayoutAnalyzer()
    metadata = analyzer.analyze_full(img)
    
    # helper for serializing numpy types
    def default(o):
        if isinstance(o, (np.int_, np.intc, np.intp, np.int8,
            np.int16, np.int32, np.int64, np.uint8,
            np.uint16, np.uint32, np.uint64)):
            return int(o)
        elif isinstance(o, (np.float_, np.float16, np.float32, 
            np.float64)):
            return float(o)
        elif isinstance(o, (np.ndarray,)): 
            return o.tolist()
        raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

    print(json.dumps(metadata, indent=2, default=default))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/manual_analyze.py <path_to_image>")
        sys.exit(1)
    
    analyze(sys.argv[1])
