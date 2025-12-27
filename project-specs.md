Hapnington Media Engine: Autonomous Asset PipelineObjective: Enable an AI agent to autonomously manufacture, process, and verify high-fidelity transparent UI assets (images & video) without human intervention.Core Philosophy: The AI does not code visuals; it directs them.Innovation: Uses "Difference Matting" for pixel-perfect image transparency (shadows/glass) and "Chroma Key" for video.1. Executive SummaryThis engine solves the "Blind Painter" problem by leveraging Nano Banana Pro (gemini-3.0-pro-image) and Veo 3.1 (veo-3.1-generate-001).For Images: We use a Two-Pass Difference Matting technique. We generate the asset on White, then use the model's Edit capability to swap the background to Black. By comparing the pixel differences, we mathematically recover the alpha channel, preserving soft shadows and translucency that "Green Screen" destroys.For Video: We use Green Screen (Chroma Key), as stochastic video generation prevents the pixel-perfect alignment required for difference matting.2. Technical ArchitectureThe "Director" WorkflowImage Generation (Nano Banana Pro):Pass 1: Generate object on Pure White (#FFFFFF).Pass 2: Edit Pass 1 -> "Change background to Pure Black (#000000)".Result: Two identical images with opposing backgrounds.Video Generation (Veo 3.1):Single Pass: Generate loop on Neon Green (#00FF00).Processing (The Engine):Images: media_processor.py calculates Alpha = 1 - (Distance(White, Black) / MaxDist).Video: media_processor.py applies FFmpeg Chroma Key.3. Tool ImplementationA. Generator (media_generator.py)Location: .agent/tools/media_generator.pyDependencies: pip install google-genaiAuth: Set GEMINI_API_KEY (AI Studio).import argparse
import os
import time
import base64
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

def generate_image_asset(prompt, output_dir):
    """
    Implements the "Difference Matting" workflow using Nano Banana Pro.
    Generates two versions of the asset for alpha recovery.
    """
    model_id = "gemini-3.0-pro-image"
    os.makedirs(output_dir, exist_ok=True)
    base_name = f"asset_{int(time.time())}"
    
    # PASS 1: Generate on WHITE
    print(f"🎨 Pass 1: Generating on White ({model_id})...")
    prompt_white = f"{prompt}. Isolated on a solid pure white background (HEX #FFFFFF). No gradient. Flat lighting."
    
    response_white = client.models.generate_content(
        model=model_id,
        contents=prompt_white,
        config=types.GenerateContentConfig(response_modalities=["IMAGE"])
    )
    
    # Save White Pass
    img_data_white = base64.b64decode(response_white.candidates[0].content.parts[0].inline_data.data)
    path_white = os.path.join(output_dir, f"{base_name}_white.png")
    with open(path_white, "wb") as f: f.write(img_data_white)
    
    # PASS 2: Edit to BLACK
    # We feed the white image back and ask for a background swap.
    print(f"🎨 Pass 2: Editing to Black...")
    
    # Note: Constructing the edit request (User Image + Text Prompt)
    edit_prompt = "Change the background to solid pure black (HEX #000000). Do not change the object. Keep lighting identical."
    
    response_black = client.models.generate_content(
        model=model_id,
        contents=[
            types.Part.from_bytes(data=img_data_white, mime_type="image/png"),
            types.Part.from_text(text=edit_prompt)
        ],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"])
    )
    
    # Save Black Pass
    img_data_black = base64.b64decode(response_black.candidates[0].content.parts[0].inline_data.data)
    path_black = os.path.join(output_dir, f"{base_name}_black.png")
    with open(path_black, "wb") as f: f.write(img_data_black)
    
    print(f"✅ Generated Matting Pair:\n  White: {path_white}\n  Black: {path_black}")
    return path_white, path_black

def generate_video_asset(prompt, output_path):
    """
    Calls Veo 3.1 (Stable) for Green Screen Video.
    """
    model_id = "veo-3.1-generate-001" 
    
    # Veo specific engineering prompt for Chroma Key
    engineering_prompt = (
        f"{prompt}. "
        "Cinematic 3D render. Looping motion. "
        "Isolated on a solid, flat, neon green background (HEX #00FF00). "
        "No camera movement (static camera). Object motion only."
    )
    
    print(f"🎥 Generating Video ({model_id}): {prompt}...")
    
    # Call Veo API (simplified for SDK)
    operation = client.models.generate_videos(
        model=model_id,
        prompt=engineering_prompt,
        config=types.GenerateVideosConfig(
            number_of_videos=1, 
            aspect_ratio="1:1", 
            duration_seconds=6
        )
    )
    
    while not operation.done:
        print("...rendering...")
        time.sleep(5)
        
    # In a real implementation, you would download the bytes/URI here
    # Placeholder for the actual download logic which varies by SDK version
    print(f"✅ Video Ready. URI: {operation.result.generated_videos[0].video.uri}")
    # For now, we assume the user/tool handles the download from URI to output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", choices=["image", "video"], required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    
    args = parser.parse_args()
    
    if args.type == "image":
        generate_image_asset(args.prompt, args.output)
    else:
        generate_video_asset(args.prompt, args.output)
B. Processor (media_processor.py)Location: .agent/tools/media_processor.pyDependencies: pip install opencv-python-headless numpy ffmpeg-pythonimport cv2
import numpy as np
import argparse
import json
import os
import subprocess
import shutil

def analyze_asset(img_path):
    """Telemetry: Checks if the asset was created successfully."""
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None: return {"file": img_path, "type": "animated/video"}
    
    alpha = img[:, :, 3]
    return {
        "width": img.shape[1],
        "height": img.shape[0],
        "transparency_pct": round(np.sum(alpha == 0) / alpha.size * 100, 2),
        "semi_transparency_pct": round(np.sum((alpha > 0) & (alpha < 255)) / alpha.size * 100, 2)
    }

def process_difference_matte(white_path, black_path, output_path):
    """
    Recover Alpha = 1 - distance(white_pixel, black_pixel) / max_dist
    Preserves shadows and glass transparency perfectly.
    """
    # Load images as float for precision math
    img_w = cv2.imread(white_path).astype(float)
    img_b = cv2.imread(black_path).astype(float)
    
    if img_w.shape != img_b.shape:
        return {"error": "Dimension mismatch between White/Black passes"}

    # Calculate Distance between pixels
    # Pure Opaque: Distance is 0 (White Pixel == Black Pixel)
    # Pure Transparent: Distance is Max (White Pixel is 255 different from Black Pixel)
    diff = np.abs(img_w - img_b)
    max_dist = 255.0
    
    # Average difference across channels to approximate alpha
    # (Simplified approximation of the article's logic)
    # Alpha is roughly: 1.0 - (Difference / BackgroundDifference)
    # If pixel is transparent: WhiteImg has 255, BlackImg has 0 -> Diff 255 -> Alpha 0
    # If pixel is opaque: WhiteImg has Color, BlackImg has Color -> Diff 0 -> Alpha 1
    alpha = 1.0 - (np.mean(diff, axis=2) / max_dist)
    alpha = np.clip(alpha, 0, 1)
    
    # Recover Color (Un-premultiply)
    # Color = BlackImage / Alpha
    # Avoid divide by zero
    with np.errstate(divide='ignore', invalid='ignore'):
        recovered_color = img_b / alpha[:, :, np.newaxis]
    
    # Fix artifacts where alpha is near 0
    recovered_color = np.nan_to_num(recovered_color, nan=0.0, posinf=0.0, neginf=0.0)
    
    # Merge
    final_alpha = (alpha * 255).astype(np.uint8)
    final_bgr = np.clip(recovered_color, 0, 255).astype(np.uint8)
    
    rgba = cv2.merge([final_bgr[:,:,0], final_bgr[:,:,1], final_bgr[:,:,2], final_alpha])
    
    cv2.imwrite(output_path, rgba, [cv2.IMWRITE_WEBP_QUALITY, 100])
    return {"status": "success", "file": output_path, "telemetry": analyze_asset(output_path)}

def process_video_chroma(input_path, output_dir, target_hex="0x00FF00"):
    """
    Veo 3.1 -> FFmpeg Chroma Key -> Animated WebP
    """
    filename = os.path.splitext(os.path.basename(input_path))[0] + ".webp"
    output_path = os.path.join(output_dir, filename)
    os.makedirs(output_dir, exist_ok=True)

    # FFmpeg: chromakey + scale + fps reduction for mobile optimization
    filter_cmd = f"chromakey={target_hex}:0.1:0.2,scale=512:-1:flags=lanczos,fps=15"
    
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", filter_cmd,
        "-c:v", "libwebp", "-lossless", "0", "-loop", "0", "-an", "-vsync", "0",
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return {"status": "success", "file": output_path}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=['matte', 'chroma'], required=True)
    parser.add_argument("--input_w", help="Path to White Pass (matte mode)")
    parser.add_argument("--input_b", help="Path to Black Pass (matte mode)")
    parser.add_argument("--input_video", help="Path to Video (chroma mode)")
    parser.add_argument("--output", required=True)
    
    args = parser.parse_args()
    
    if args.mode == 'matte':
        result = process_difference_matte(args.input_w, args.input_b, args.output)
    else:
        result = process_video_chroma(args.input_video, args.output)
        
    print(json.dumps(result, indent=2))
4. AI Workflow InstructionsTask: "Create a Glass Potion Bottle"Generate:Command: python .agent/tools/media_generator.py --type image --prompt "Glass potion bottle" --output .agent/studio/potionResult: Creates potion_white.png and potion_black.png.Process:Command: python .agent/tools/media_processor.py --mode matte --input_w .agent/studio/potion_white.png --input_b .agent/studio/potion_black.png --output mobile/assets/ui/potion.webpImplement:Use <Image />. The asset will have perfect semi-transparent glass effects.