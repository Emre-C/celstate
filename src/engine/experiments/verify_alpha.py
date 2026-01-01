from PIL import Image
import sys

def verify_alpha(file_path):
    try:
        img = Image.open(file_path)
        print(f"Format: {img.format}")
        print(f"Mode: {img.mode}")
        print(f"Size: {img.size}")
        
        frames = getattr(img, "n_frames", 1)
        print(f"Frames: {frames}")
        
        transparent_frames = 0
        for i in range(frames):
            img.seek(i)
            if img.mode != 'RGBA':
                continue
            
            # Check a sample or the whole frame
            extrema = img.getextrema()
            # extrema for RGBA is ((minR, maxR), (minG, maxG), (minB, maxB), (minA, maxA))
            alpha_extrema = extrema[3]
            if alpha_extrema[0] < 255:
                transparent_frames += 1
        
        print(f"Transparent Frames Found: {transparent_frames}")
        if transparent_frames > 0:
            print("SUCCESS: Transparency verified!")
        else:
            print("FAILURE: No transparent pixels found (Alpha channel is fully opaque).")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else "runcomfy_output.webp"
    verify_alpha(file_path)
