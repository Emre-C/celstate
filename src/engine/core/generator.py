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

    def generate_video_loop_pair(
        self, 
        prompt: str, 
        name: str, 
        studio_dir: Path, 
        aspect_ratio: str = "16:9",
        seed: Optional[int] = None,
    ) -> Dict[str, str]:
        """
        EXPERIMENTAL: Generates dual-pass looping videos for Difference Matting.
        
        Uses Veo 3.1's first/last frame interpolation with identical start/end frames
        to create two videos (white and black background) that should have aligned motion.
        
        Returns paths to both videos for comparison/matting.
        """
        studio_dir.mkdir(parents=True, exist_ok=True)
        
        target_aspect = aspect_ratio
        if aspect_ratio == "1:1":
            print(f"WARNING: Aspect ratio '1:1' not supported. Auto-correcting to '16:9' for '{name}'.")
            target_aspect = "16:9"
        
        # Step 1: Generate anchor frame on WHITE
        print(f"[DualPass] Generating white anchor frame for '{name}'...")
        prompt_white = (
            f"{prompt}. "
            "Isolated on solid pure white background (HEX #FFFFFF). "
            "No gradient. Flat, even lighting. No shadows on background. "
            "Centered composition."
        )
        
        response_white = self.client.models.generate_content(
            model=IMAGE_MODEL,
            contents=[prompt_white],
        )
        
        white_image = None
        for part in response_white.parts:
            if part.inline_data is not None:
                white_image = part.as_image()
                break
        
        if white_image is None:
            raise RuntimeError("Failed to generate white anchor frame")
        
        path_white_frame = studio_dir / f"{name}_anchor_white.png"
        white_image.save(str(path_white_frame))
        
        # Step 2: Generate anchor frame on BLACK (edit from white to maintain subject)
        print(f"[DualPass] Generating black anchor frame for '{name}'...")
        edit_prompt = (
            "Change the background to solid pure black (HEX #000000). "
            "Keep the object IDENTICAL - same position, size, pose, lighting on subject."
        )
        
        white_bytes = None
        for part in response_white.parts:
            if part.inline_data is not None:
                white_bytes = part.inline_data.data
                break
        
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
            raise RuntimeError("Failed to generate black anchor frame")
        
        path_black_frame = studio_dir / f"{name}_anchor_black.png"
        black_image.save(str(path_black_frame))
        
        # Step 3: Use in-memory Image objects directly (as per official docs)
        # white_image and black_image from as_image() can be passed directly to Veo
        print(f"[DualPass] Using generated Image objects directly for Veo...")
        
        # Step 4: Generate WHITE video using first=last=white_image (creates loop)
        print(f"[DualPass] Generating white looping video for '{name}'...")
        
        loop_prompt = (
            f"{prompt}. "
            "Gentle continuous motion. Subtle idle animation. "
            "Seamless loop - end pose matches start pose exactly. "
            "Static camera. Subject moves naturally."
        )
        
        # Use a fixed seed if not provided
        actual_seed = seed if seed is not None else 42
        print(f"[DualPass] Using random_seed={actual_seed} for consistent motion.")

        video_config_white = types.GenerateVideosConfig(
            number_of_videos=1,
            aspect_ratio=target_aspect,
            duration_seconds=4,
            last_frame=white_image,
            seed=actual_seed
        )
        
        operation_white = self.client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=loop_prompt,
            image=white_image,  # First frame (in-memory Image from generation)
            config=video_config_white,
        )
        
        while not operation_white.done:
            time.sleep(10)
            operation_white = self.client.operations.get(operation_white)
        
        
        
        video_white = operation_white.response.generated_videos[0]
        video_resource = video_white.video
        
        path_white_video = studio_dir / f"{name}_loop_white.mp4"

        if hasattr(video_resource, 'video_bytes') and video_resource.video_bytes:
            print(f"[DualPass] Saving video bytes directly for '{name}' (Vertex)...")
            with open(str(path_white_video), "wb") as f:
                f.write(video_resource.video_bytes)
        else:
            self.client.files.download(file=video_resource)
            video_resource.save(str(path_white_video))
        
        # Step 5: Generate BLACK video using first=last=black_image (creates loop)
        print(f"[DualPass] Generating black looping video for '{name}'...")
        
        video_config_black = types.GenerateVideosConfig(
            number_of_videos=1,
            aspect_ratio=target_aspect,
            duration_seconds=4,
            last_frame=black_image, # Same as first = loop constraint
            seed=actual_seed
        )
        
        operation_black = self.client.models.generate_videos(
            model=VIDEO_MODEL,
            prompt=loop_prompt,  # Same prompt
            image=black_image,  # First frame (in-memory Image from generation)
            config=video_config_black,
        )
        
        while not operation_black.done:
            time.sleep(10)
            operation_black = self.client.operations.get(operation_black)
        
        video_black = operation_black.response.generated_videos[0]
        video_resource_black = video_black.video
        
        path_black_video = studio_dir / f"{name}_loop_black.mp4"
        
        if hasattr(video_resource_black, 'video_bytes') and video_resource_black.video_bytes:
             with open(str(path_black_video), "wb") as f:
                 f.write(video_resource_black.video_bytes)
        else:
             self.client.files.download(file=video_resource_black)
             video_resource_black.save(str(path_black_video))
        
        print(f"[DualPass] Completed! White: {path_white_video}, Black: {path_black_video}")
        
        return {
            "white_frame": str(path_white_frame),
            "black_frame": str(path_black_frame),
            "white_video": str(path_white_video),
            "black_video": str(path_black_video),
            "seed": seed,
        }
