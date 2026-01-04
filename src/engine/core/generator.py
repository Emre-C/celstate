import os
import time
from pathlib import Path
from typing import Callable, Dict, Optional, TYPE_CHECKING, TypeVar

from google import genai
from google.genai import types
from google.genai.errors import ClientError
import io
from PIL import Image

from src.engine.core.interpreter import CreativeInterpreter

if TYPE_CHECKING:
    from src.engine.core.tracer import Tracer

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
    "container": "16:9",  # Wide pill shape (widest supported standard)
    "icon": "1:1",        # Square icon
    "texture": "1:1",     # Tileable square
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
        
        # Creative interpretation layer (Kimi-K2 via HuggingFace)
        self.interpreter = CreativeInterpreter()

    def _call_with_retry(
        self, 
        api_call: Callable[[], T], 
        operation_name: str,
        tracer: Optional["Tracer"] = None
    ) -> T:
        """Execute an API call with exponential backoff retry on 429 errors.
        
        Args:
            api_call: A zero-argument callable that makes the API request.
            operation_name: Human-readable name for logging (e.g., "white_pass").
            tracer: Optional tracer for observability.
            
        Returns:
            The result of the successful API call.
            
        Raises:
            ClientError: If all retries are exhausted or a non-retryable error occurs.
        """
        backoff = INITIAL_BACKOFF_SECONDS
        last_exception: Optional[ClientError] = None
        
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return api_call()
            except ClientError as e:
                # Only retry on 429 RESOURCE_EXHAUSTED
                if e.code != 429:
                    raise
                
                last_exception = e
                
                if attempt == MAX_RETRIES:
                    # Exhausted all retries
                    if tracer:
                        tracer.record("retry_exhausted", {
                            "operation": operation_name,
                            "attempts": attempt,
                            "error": str(e)
                        })
                    raise
                
                # Log retry attempt
                if tracer:
                    tracer.record("retry_attempt", {
                        "operation": operation_name,
                        "attempt": attempt,
                        "backoff_seconds": backoff,
                        "error": str(e)
                    })
                
                time.sleep(backoff)
                backoff = min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_SECONDS)
        
        # Should never reach here, but satisfy type checker
        raise last_exception or RuntimeError("Unexpected retry loop exit")

    def _get_aspect_ratio(self, asset_type: str) -> str:
        """Returns the aspect ratio for the given asset type."""
        return ASPECT_RATIOS.get(asset_type, "1:1")

    def _get_geometry_spec(self, asset_type: str) -> str:
        """Returns strict geometry constraints based on asset_type."""
        specs = {
            "container": (
                "PILL/CAPSULE shaped frame with HOLLOW CENTER. "
                "The CENTER of the pill MUST be filled with the SAME SOLID COLOR as the background. "
                "This creates a 'cutout' effect where the center becomes transparent after processing. "
                "Do NOT add any decorative content in the center - it must be pure solid background color. "
                "The decorative edges should frame the empty center without obscuring it. "
                "9-slice compatible (stretchable center region)."
            ),
            "icon": (
                "Centered icon/glyph. "
                "Single focal point with padding around edges. "
                "No hollow center required."
            ),
            "texture": (
                "Seamless tileable pattern. "
                "No focal point. Repeating structure. "
                "Edges must tile seamlessly."
            ),
        }
        return specs.get(asset_type, "UI element.")

    def _enhance_prompt(self, prompt: str, asset_type: str, style_context: str) -> str:
        """
        Build prompt with STRICT separation between:
        - GEOMETRY: Layout constraints (bounding shape, hollow center)
        - STYLE: Creative direction (free-form, user-controlled)
        
        This separation ensures organic styles (Ghibli, watercolor, etc.) aren't
        fought by implicit vector-forcing prompts.
        """
        geometry_spec = self._get_geometry_spec(asset_type)
        
        enhanced = (
            f"=== GEOMETRY (STRICT) ===\n"
            f"{geometry_spec}\n\n"
            f"=== STYLE (EMBELLISH THE GEOMETRY) ===\n"
            f"{style_context}\n\n"
            f"=== CONTENT ===\n"
            f"{prompt}\n\n"
            f"CONSTRAINT: Style must EMBELLISH the geometry, not obscure it. "
            f"The hollow center region must remain filled with pure background color."
        )
        return enhanced

    def generate_image_pair(
        self, 
        prompt: str, 
        name: str, 
        studio_dir: Path, 
        asset_type: str, 
        style_context: str,
        render_size_hint: Optional[int] = None,
        tracer: Optional["Tracer"] = None
    ) -> Dict[str, str]:
        """Generates white and black pass images for difference matting.
        
        Args:
            prompt: Creative description of the asset
            name: Filename base for outputs
            studio_dir: Directory for intermediate files
            asset_type: container, icon, or texture
            style_context: User-provided style direction
            render_size_hint: Approximate target width for optical sizing
            tracer: Optional tracer for observability
        """
        studio_dir.mkdir(parents=True, exist_ok=True)
        
        # Creative interpretation layer: transform generic prompt into imaginative description
        interpreted_prompt = self.interpreter.interpret(
            prompt, 
            asset_type, 
            style_context, 
            render_size_hint=render_size_hint,
            tracer=tracer
        )
        
        base_prompt = self._enhance_prompt(interpreted_prompt, asset_type, style_context)
        aspect_ratio = self._get_aspect_ratio(asset_type)
        
        # Pass 1: White background + white hollow center
        prompt_white = (
            f"{base_prompt}\n\n"
            "=== BACKGROUND ===\n"
            "Solid pure white background (HEX #FFFFFF). "
            "No gradient. Flat, even lighting. No shadows on background. "
            "If this is a container with a hollow center, the center MUST also be pure white #FFFFFF. "
            "Centered composition with padding for touch targets."
        )
        
        image_config = types.ImageConfig(aspect_ratio=aspect_ratio)
        gen_config = types.GenerateContentConfig(image_config=image_config)
        
        # Validation & Retry Loop for White Pass
        white_image = None
        white_bytes = None
        current_retry = 0
        max_validation_retries = 3
        
        while current_retry <= max_validation_retries:
            # Record white pass request
            if tracer:
                tracer.record("gemini_request", {
                    "pass": "white",
                    "model": IMAGE_MODEL,
                    "prompt": prompt_white,
                    "aspect_ratio": aspect_ratio,
                    "attempt": current_retry + 1
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
            
            # Extract image
            for part in response_white.parts:
                if part.inline_data is not None:
                    white_image = part.as_image()
                    white_bytes = part.inline_data.data
                    break
            
            if white_image is None or white_bytes is None:
                raise RuntimeError("Failed to generate white-pass image (no image data returned)")
                
            # VALIDATION: Check for Black Background Hallucination
            # Verify that corners are actually white (or close to it)
            # Use PIL to read bytes directly to ensure we have a valid PIL Image
            try:
                pil_image = Image.open(io.BytesIO(white_bytes))
                w, h = pil_image.size
                
                # Sample 4 corners
                corners = [
                    pil_image.getpixel((0, 0)),
                    pil_image.getpixel((w - 1, 0)),
                    pil_image.getpixel((0, h - 1)),
                    pil_image.getpixel((w - 1, h - 1))
                ]
                
                # Helper to get brightness (handling RGB/RGBA/Grayscale)
                def get_brightness(px):
                    if isinstance(px, int): return px # Grayscale
                    if len(px) >= 3: return sum(px[:3]) / 3.0 # RGB/RGBA
                    return 0
                    
                avg_corner_brightness = sum(get_brightness(c) for c in corners) / 4.0
                
                # Threshold: 240/255 (allow for some compression artifacts/noise)
                if avg_corner_brightness >= 240:
                    # Valid White Background
                    break
                else:
                    # Invalid - Model Hallucinated Background
                    msg = f"Model validation failed: Expected white background (mean > 240), got {avg_corner_brightness:.1f}. Retrying..."
                    if tracer:
                        tracer.record("validation_error", {
                            "pass": "white",
                            "error": msg,
                            "attempt": current_retry + 1
                        })
                    
                    current_retry += 1
                    if current_retry > max_validation_retries:
                        raise RuntimeError(f"Model persistently failed to generate white background after {max_validation_retries} retries.")
            except Exception as e:
                # Fallback if image parsing fails (shouldn't happen with valid bytes)
                if tracer:
                    tracer.record("validation_error", {
                        "pass": "white",
                        "error": f"Image parsing failed during validation: {str(e)}",
                        "attempt": current_retry + 1
                    })
                current_retry += 1
                if current_retry > max_validation_retries:
                    raise
                    
        # Record white pass success
        if tracer:
            tracer.record("gemini_response", {
                "pass": "white",
                "status": "success",
                "output_path": str(studio_dir / f"{name}_white.png")
            })
            
        path_white = studio_dir / f"{name}_white.png"
        white_image.save(str(path_white))
        
        # Pass 2: Black background + black hollow center (Edit)
        edit_prompt = (
            "Change the background to solid pure black (HEX #000000). "
            "If there is a hollow center, it must also become pure black #000000. "
            "Keep the decorative frame/edges identical - same position, size, colors, lighting."
        )
        
        image_part = types.Part.from_bytes(data=white_bytes, mime_type="image/png")
        
        # Record black pass request
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
                black_image = part.as_image()
                break
                
        if black_image is None:
            if tracer:
                tracer.record("gemini_response", {
                    "pass": "black",
                    "status": "error",
                    "error": "Failed to generate black-pass image (edit pass)"
                })
            raise RuntimeError("Failed to generate black-pass image (edit pass)")
        
        # Record black pass success
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
            "black": str(path_black)
        }



