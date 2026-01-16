"""
Media Generator for Celstate.

Generates white/black pass image pairs for difference matting.
Uses Gemini 2.5 Flash Image (Nano Banana) via Vertex AI.
"""

import os
import time
import io
from pathlib import Path
from typing import Callable, Dict, Optional, TYPE_CHECKING, TypeVar

from google import genai
from google.genai import types
from google.genai.errors import ClientError
from PIL import Image

from celstate.interpreter import CreativeInterpreter, infer_asset_type

if TYPE_CHECKING:
    from celstate.tracer import Tracer

# Model IDs
IMAGE_MODEL = "gemini-2.5-flash-image"

# Retry configuration for API calls
MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 32.0
BACKOFF_MULTIPLIER = 2.0

T = TypeVar("T")

# Aspect ratios per asset type (Gemini ImageConfig format)
ASPECT_RATIOS = {
    "container": "16:9",
    "icon": "1:1",
    "texture": "1:1",
    "effect": "1:1",
    "image": "1:1",
    "decoration": "1:1",
}


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
        
        self.interpreter = CreativeInterpreter()

    def _call_with_retry(
        self, 
        api_call: Callable[[], T], 
        operation_name: str,
        tracer: Optional["Tracer"] = None
    ) -> T:
        """Execute an API call with exponential backoff retry on 429 errors."""
        backoff = INITIAL_BACKOFF_SECONDS
        last_exception: Optional[ClientError] = None
        
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return api_call()
            except ClientError as e:
                if e.code != 429:
                    raise
                
                last_exception = e
                
                if attempt == MAX_RETRIES:
                    if tracer:
                        tracer.record("retry_exhausted", {
                            "operation": operation_name,
                            "attempts": attempt,
                            "error": str(e)
                        })
                    raise
                
                if tracer:
                    tracer.record("retry_attempt", {
                        "operation": operation_name,
                        "attempt": attempt,
                        "backoff_seconds": backoff,
                        "error": str(e)
                    })
                
                time.sleep(backoff)
                backoff = min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_SECONDS)
        
        raise last_exception or RuntimeError("Unexpected retry loop exit")

    def _get_aspect_ratio(self, asset_type: str) -> str:
        """Returns the aspect ratio for the given asset type."""
        return ASPECT_RATIOS.get(asset_type, "1:1")

    def _get_geometry_spec(self, asset_type: str) -> str:
        """Returns geometry constraints based on inferred asset_type."""
        specs = {
            "container": (
                "HOLLOW CENTER REQUIRED: The CENTER of the frame MUST be filled with "
                "the SAME SOLID COLOR as the background. This creates a cutout effect. "
                "Do NOT add any decorative content in the center."
            ),
            "icon": (
                "Centered composition with padding around edges. Single focal point."
            ),
            "texture": (
                "Seamless tileable pattern. Edges must tile seamlessly."
            ),
            "effect": (
                "Visual effect with transparency. Elements should have clear boundaries."
            ),
        }
        return specs.get(asset_type, "")

    def generate_image_pair(
        self,
        prompt: str,
        name: str,
        studio_dir: Path,
        asset_type: Optional[str] = None,
        style_context: Optional[str] = None,
        render_size_hint: Optional[int] = None,
        tracer: Optional["Tracer"] = None,
    ) -> Dict[str, str]:
        """Generates white and black pass images for difference matting.
        
        Args:
            prompt: User's prompt (will be interpreted for transparency safety)
            name: Filename base for outputs
            studio_dir: Directory for intermediate files
            tracer: Optional tracer for observability
            
        Returns:
            Dict with 'white' and 'black' paths, and 'asset_type'
        """
        studio_dir.mkdir(parents=True, exist_ok=True)
        
        # Infer asset type from prompt if not provided
        resolved_asset_type = asset_type or infer_asset_type(prompt)

        # Interpret prompt for transparency safety
        interpreted_prompt = self.interpreter.interpret(
            prompt,
            asset_type=resolved_asset_type,
            style_context=style_context,
            render_size_hint=render_size_hint,
            tracer=tracer,
        )
        
        # Build final prompt with geometry constraints
        geometry_spec = self._get_geometry_spec(resolved_asset_type)
        aspect_ratio = self._get_aspect_ratio(resolved_asset_type)
        
        base_prompt = f"{interpreted_prompt}\n\n{geometry_spec}" if geometry_spec else interpreted_prompt
        
        # Pass 1: White background
        prompt_white = (
            f"{base_prompt}\n\n"
            "BACKGROUND: Solid pure white (#FFFFFF). No gradient. No shadows on background. "
            "Centered composition with padding."
        )
        
        if resolved_asset_type == "container":
            prompt_white += " The hollow center must also be pure white #FFFFFF."
        
        image_config = types.ImageConfig(aspect_ratio=aspect_ratio)
        gen_config = types.GenerateContentConfig(image_config=image_config)
        
        # Generate white pass with validation
        white_image = None
        white_bytes = None
        max_validation_retries = 3
        
        for attempt in range(max_validation_retries + 1):
            if tracer:
                tracer.record("gemini_request", {
                    "pass": "white",
                    "model": IMAGE_MODEL,
                    "prompt": prompt_white,
                    "aspect_ratio": aspect_ratio,
                    "attempt": attempt + 1
                })
            
            response_white = self._call_with_retry(
                lambda: self.client.models.generate_content(
                    model=IMAGE_MODEL,
                    contents=[prompt_white],
                    config=gen_config,
                ),
                operation_name="white_pass",
                tracer=tracer
            )
            
            for part in response_white.parts:
                if part.inline_data is not None:
                    white_bytes = part.inline_data.data
                    white_image = Image.open(io.BytesIO(white_bytes))
                    break
            
            if white_image is None or white_bytes is None:
                raise RuntimeError("Failed to generate white-pass image (no image data returned)")
            
            # Validate white background
            try:
                w, h = white_image.size
                corners = [
                    white_image.getpixel((0, 0)),
                    white_image.getpixel((w - 1, 0)),
                    white_image.getpixel((0, h - 1)),
                    white_image.getpixel((w - 1, h - 1))
                ]
                
                def get_brightness(px):
                    if isinstance(px, int):
                        return px
                    if len(px) >= 3:
                        return sum(px[:3]) / 3.0
                    return 0
                
                avg_corner_brightness = sum(get_brightness(c) for c in corners) / 4.0
                
                if avg_corner_brightness >= 240:
                    break  # Valid
                elif attempt == max_validation_retries:
                    raise RuntimeError(f"Model failed to generate white background after {max_validation_retries} retries")
                    
                if tracer:
                    tracer.record("validation_error", {
                        "pass": "white",
                        "brightness": avg_corner_brightness,
                        "attempt": attempt + 1
                    })
            except RuntimeError:
                raise
            except Exception as e:
                if attempt == max_validation_retries:
                    raise RuntimeError(f"Image validation failed: {e}")
        
        if tracer:
            tracer.record("gemini_response", {
                "pass": "white",
                "status": "success",
                "output_path": str(studio_dir / f"{name}_white.png")
            })
        
        if white_image is None or white_bytes is None:
            raise RuntimeError("White image generation failed")
        
        path_white = studio_dir / f"{name}_white.png"
        white_image.save(str(path_white))
        
        # Pass 2: Black background (edit of white pass)
        edit_prompt = (
            "Strictly change ALL negative space from White to solid Pure Black (#000000). "
            "This includes the outer background and any internal voids. "
            "CRITICAL: Do not crop, zoom, or shift. Foreground must match pixel-for-pixel."
        )
        
        image_part = types.Part.from_bytes(data=white_bytes, mime_type="image/png")
        
        if tracer:
            tracer.record("gemini_request", {
                "pass": "black",
                "model": IMAGE_MODEL,
                "prompt": edit_prompt,
                "type": "edit"
            })
        
        response_black = self._call_with_retry(
            lambda: self.client.models.generate_content(
                model=IMAGE_MODEL,
                contents=[edit_prompt, image_part],
            ),
            operation_name="black_pass",
            tracer=tracer
        )
        
        black_image = None
        for part in response_black.parts:
            if part.inline_data is not None:
                black_image = Image.open(io.BytesIO(part.inline_data.data))
                break
                
        if black_image is None:
            if tracer:
                tracer.record("gemini_response", {
                    "pass": "black",
                    "status": "error",
                    "error": "Failed to generate black-pass image"
                })
            raise RuntimeError("Failed to generate black-pass image (edit pass)")
        
        if tracer:
            tracer.record("gemini_response", {
                "pass": "black",
                "status": "success",
                "output_path": str(studio_dir / f"{name}_black.png")
            })
        
        path_black = studio_dir / f"{name}_black.png"
        black_image.save(str(path_black))
        
        return {
            "white": str(path_white),
            "black": str(path_black),
            "asset_type": resolved_asset_type
        }
