import sys
import os
import logging
from pathlib import Path
from PIL import Image

# Add root to path (assuming scripts/ is one level deep)
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(root_dir)

# Now we can import from src
try:
    from src.celstate.generator import MediaGenerator
except ImportError:
    print(f"Failed to import src.celstate.generator. sys.path is: {sys.path}")
    sys.exit(1)

# Setup logging to see interpreter output
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
# Set interpreter logger specific level if needed, but INFO is default

def test_optical_sizing():
    print("--- Starting Optical Sizing Verification ---")
    
    # Check env vars
    required_vars = ["VERTEX_API_KEY", "VERTEX_PROJECT_ID", "VERTEX_LOCATION", "HF_TOKEN"]
    missing = [v for v in required_vars if not os.environ.get(v)]
    if missing:
        print(f"WARNING: Missing environment variables: {missing}. Test might fail or run in degraded mode.")
    
    try:
        generator = MediaGenerator()
    except Exception as e:
        print(f"Failed to initialize MediaGenerator: {e}")
        return

    studio_dir = Path("jobs/test_optical_sizing/studio")
    
    # Test Case 1: XS Tier Override
    # Prompt implies complex texture, but size is tiny.
    prompt = "A simple notification dot"
    style = "Ornate victorian watercolor with heavy grain and texture"
    size_hint = 32 # XS Tier (< 48)
    
    print(f"\n[Test] Generating with hint={size_hint}px. Style='{style}' (Should be OVERRIDDEN)")
    
    try:
        paths = generator.generate_image_pair(
            prompt=prompt,
            name="test_dot_xs",
            studio_dir=studio_dir,
            asset_type="icon",
            style_context=style,
            render_size_hint=size_hint
        )
        
        print("\n[Verification] Checking output...")
        
        # Check White Pass
        white_path = paths['white']
        if not os.path.exists(white_path):
            print(f"FAILURE: White pass file not found at {white_path}")
        else:
            img = Image.open(white_path)
            print(f"White output size: {img.size}")
            
            if img.size[0] == size_hint:
                print(f"SUCCESS: Output width matches hint ({size_hint}px)")
            else:
                print(f"FAILURE: Output width {img.size[0]} does not match hint {size_hint}")

        # Check Black Pass
        black_path = paths['black']
        if not os.path.exists(black_path):
             print(f"FAILURE: Black pass file not found at {black_path}")
        else:
            img_black = Image.open(black_path)
            print(f"Black output size: {img_black.size}")
            
            if img_black.size[0] == size_hint:
                 print(f"SUCCESS: Black output width matches hint ({size_hint}px)")
            else:
                 print(f"FAILURE: Black output width {img_black.size[0]} does not match hint {size_hint}")

    except Exception as e:
        print(f"GENERATION FAILED: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_optical_sizing()
