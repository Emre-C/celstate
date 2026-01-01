import os
import time
from pathlib import Path
from generator import MediaGenerator

def test_realistic_generation():
    print("Testing REALISTIC UI Asset Generation (Approach 1.6)...")
    
    try:
        generator = MediaGenerator()
        
        studio_dir = Path("debug_output_realistic")
        studio_dir.mkdir(exist_ok=True)
        
        # A representative asset: Glossy, colorful, non-reflective (matte highlights)
        test_seed = 999
        print(f"Using Seed: {test_seed}")
        
        result = generator.generate_video_loop_pair(
            prompt="A 3D stylized vibrant red heart pulsing gently, glossy finish, claymorphism style",
            name="ui_heart",
            studio_dir=studio_dir,
            aspect_ratio="16:9",
            seed=test_seed
        )
        
        print("Generation Success!")
        print(f"White Video: {result['white_video']}")
        print(f"Black Video: {result['black_video']}")
        
    except Exception as e:
        print(f"FAILED: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    test_realistic_generation()
