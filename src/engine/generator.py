import os
import time
from pathlib import Path
from typing import Dict, Optional

from google import genai
from google.genai import types

# Model IDs
IMAGE_MODEL = "gemini-2.5-flash-image"
VIDEO_MODEL = "veo-3.1-fast-generate-preview"

# Mobile UI prompt enhancements
MOBILE_IMAGE_CONTEXT = (
    "Mobile app UI element. "
    "High contrast, crisp edges, touch-friendly proportions. "
    "Clean vector-style rendering. "
    "Suitable for dark and light mode backgrounds."
)

MOBILE_VIDEO_CONTEXT = (
    "Smooth, subtle animation suitable for mobile UI. "
    "Looping seamlessly. Battery-efficient motion (no rapid changes). "
    "Works as a background or accent animation."
)

class MediaGenerator:
    def __init__(self, api_key: Optional[str] = None):
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY must be provided or set in environment")
        self.client = genai.Client(api_key=key)

    def _enhance_prompt(self, prompt: str, asset_type: str) -> str:
        context = MOBILE_IMAGE_CONTEXT if asset_type == "image" else MOBILE_VIDEO_CONTEXT
        return f"{prompt}. {context}"

    def generate_image_pair(self, prompt: str, name: str, studio_dir: Path) -> Dict[str, str]:
        """Generates white and black pass images for difference matting."""
        studio_dir.mkdir(parents=True, exist_ok=True)
        mobile_prompt = self._enhance_prompt(prompt, "image")
        
        # Pass 1: White
        prompt_white = (
            f"{mobile_prompt}. "
            "Isolated on a solid pure white background (HEX #FFFFFF). "
            "No gradient. Flat, even lighting. No shadows on background. "
            "Centered composition with padding for touch targets."
        )
        
        response_white = self.client.models.generate_content(
            model=IMAGE_MODEL,
            contents=[prompt_white],
        )
        
        white_image = None
        white_bytes = None
        for part in response_white.parts:
            if part.inline_data is not None:
                white_image = part.as_image()
                white_bytes = part.inline_data.data
                break
        
        if white_image is None or white_bytes is None:
            raise RuntimeError("Failed to generate white-pass image")
            
        path_white = studio_dir / f"{name}_white.png"
        white_image.save(str(path_white))
        
        # Pass 2: Black (Edit)
        edit_prompt = (
            "Change the background to solid pure black (HEX #000000). "
            "Keep the object identical - same position, size, lighting."
        )
        
        image_part = types.Part.from_bytes(data=white_bytes, mime_type="image/png")
        
        response_black = self.client.models.generate_content(
            model=IMAGE_MODEL,
            contents=[edit_prompt, image_part],
        )
        
        black_image = None
        for part in response_black.parts:
            if part.inline_data is not None:
                black_image = part.as_image()
                break
                
        if black_image is None:
            raise RuntimeError("Failed to generate black-pass image (edit pass)")
            
        path_black = studio_dir / f"{name}_black.png"
        black_image.save(str(path_black))
        
        return {
            "white": str(path_white),
            "black": str(path_black)
        }

    def generate_video(self, prompt: str, name: str, studio_dir: Path) -> str:
        """Generates green screen video."""
        studio_dir.mkdir(parents=True, exist_ok=True)
        mobile_prompt = self._enhance_prompt(prompt, "video")
        
        engineering_prompt = (
            f"{mobile_prompt}. "
            "Cinematic 3D render. Seamless loop. "
            "Isolated on solid neon green background (HEX #00FF00). "
            "Static camera, object motion only. "
            "No green reflections. Matte surface finish."
        )
        
        operation = self.client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=engineering_prompt,
            config={
                "number_of_videos": 1,
                "aspect_ratio": "1:1",
                "duration_seconds": 6,
            },
        )
        
        while not operation.done:
            time.sleep(10)
            operation = self.client.operations.get(operation)
            
        generated_video = operation.response.generated_videos[0]
        self.client.files.download(file=generated_video.video)
        
        output_path = studio_dir / f"{name}_green.mp4"
        generated_video.video.save(str(output_path))
        
        return str(output_path)
