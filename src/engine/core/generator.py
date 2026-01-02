import os
import time
from pathlib import Path
from typing import Dict, Optional

from google import genai
from google.genai import types

# Model IDs
IMAGE_MODEL = "gemini-2.5-flash-image"
VIDEO_MODEL = "veo-3.1-fast-generate-preview"  # Both fast and standard support last_frame

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
    def __init__(self):
        vertex_api_key = os.environ.get("VERTEX_API_KEY")
        vertex_project = os.environ.get("VERTEX_PROJECT_ID")
        vertex_location = os.environ.get("VERTEX_LOCATION")

        if not vertex_api_key:
            raise ValueError("VERTEX_API_KEY must be set in environment")
        if not vertex_project:
            raise ValueError("VERTEX_PROJECT_ID must be set in environment")
        if not vertex_location:
            raise ValueError("VERTEX_LOCATION must be set in environment")
            
        self.client = genai.Client(
            vertexai=True,
            project=vertex_project,
            location=vertex_location
        )

    def _enhance_prompt(self, prompt: str, asset_type: str, animation_intent: Optional[str] = None, context_hint: Optional[str] = None) -> str:
        context = MOBILE_IMAGE_CONTEXT if asset_type == "image" else MOBILE_VIDEO_CONTEXT
        
        enhanced = f"{prompt}. {context}"
        
        if animation_intent:
            # "drift-x" -> "Gentle drifting motion along the X axis."
            enhanced += f" Animation Style: {animation_intent}."
            
        if context_hint:
             enhanced += f" Context/Placement Assumption: {context_hint}."
             
        return enhanced

    def generate_image_pair(self, prompt: str, name: str, studio_dir: Path, animation_intent: Optional[str] = None, context_hint: Optional[str] = None) -> Dict[str, str]:
        """Generates white and black pass images for difference matting."""
        studio_dir.mkdir(parents=True, exist_ok=True)
        mobile_prompt = self._enhance_prompt(prompt, "image", animation_intent, context_hint)
        
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

    def generate_video(self, prompt: str, name: str, studio_dir: Path, aspect_ratio: str = "16:9", animation_intent: Optional[str] = None, context_hint: Optional[str] = None) -> str:
        """Generates green screen video."""
        studio_dir.mkdir(parents=True, exist_ok=True)
        
        # VE 3.1 Constraint Check
        # Valid: 16:9, 9:16. Invalid: 1:1.
        target_aspect = aspect_ratio
        if aspect_ratio == "1:1":
            print(f"WARNING: Aspect ratio '1:1' is not supported by Veo 3.1. Auto-correcting to '16:9' for '{name}'.")
            target_aspect = "16:9"
            
        mobile_prompt = self._enhance_prompt(prompt, "video", animation_intent, context_hint)
        
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
                "aspect_ratio": target_aspect,
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


