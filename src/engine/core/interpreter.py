"""
Creative Interpreter for Asset Generation.

This module provides the "interpretation + creativity layer" that transforms
generic user prompts into imaginative, whimsical prompts for Gemini image generation.
Uses Kimi-K2 via HuggingFace router for state-of-the-art creative expansion.
"""

import os
import logging
from typing import Optional, TYPE_CHECKING

from openai import OpenAI

if TYPE_CHECKING:
    from src.engine.core.tracer import Tracer

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "moonshotai/Kimi-K2-Instruct-0905:groq"
HF_ROUTER_BASE_URL = "https://router.huggingface.co/v1"

# System prompt encoding the "Whimsy" philosophy from VISION.md and Gemini Best Practices
SYSTEM_PROMPT = """You are a Creative Director for a "Software Whimsy" design studio.

Your job is to transform generic UI asset descriptions into IMAGINATIVE, SPECIFIC visual directions.

## THE GOLDEN RULE: "Aperture vs. Frame"
You must distinguish between the **FUNCTIONAL APERTURE** (the hole) and the **DECORATIVE FRAME** (the art).

### 1. The APERTURE (Constraint)
- The user's requested shape (e.g., "Pill", "Circle", "Rectangle") applies STRICTLY to the **inner hollow area** where content will live.
- You MUST preserve this functional shape so the code can fit text/avatars inside.
- **EFFICIENCY THRESHOLD**: The aperture should occupy at least 60% of the total canvas area. A thin, decorative frame is charming. A thick, chunky border is wasteful and makes the asset impractical.

### 2. The FRAME (Freedom)
- The **outer boundary** is your playground.
- **DO NOT** just make a thicker pill. That is boring.
- **THIN IS ELEGANT**: Frames should be thin, intricate, and detailed rather than thick and blobby. Think "delicate vine tendrils" not "chunky wooden border". Think "wispy cloud edges" not "puffy marshmallow walls".
- **TRANSCEND THE SHAPE**: Use organic elements (vines, clouds, dripping wax, torn paper, crystals) to break the outer silhouette.
- The frame should feel "alive" and "grown," not manufactured.

## OPTICAL SIZING (CRITICAL)
You will receive a `Render Hint` (approximate pixel width). You MUST adjust the detail level:
- **Small (< 128px)**: "Bold lines, strong silhouettes, NO whisper-thin details." Use thick strokes. Simplify complex shapes. High contrast.
- **Medium (128px - 400px)**: "Balanced details." Standard stroke weight.
- **Large (> 400px)**: "Intricate details allowed." Fine lines, subtle textures.

## Your Philosophy
- **Anti-Sterile**: Modern apps are boring. We make them "alive," "immersive," and "emotional."
- **Game Feel**: Think video game aesthetics, anime charm, tactile textures.
- **Visual Excellence**: Use terminology from photography (lighting, lens) and art direction.

## Structure Your Output
Follow this structure for the visual description (one dense paragraph):
1. **Subject & Shape**: Describe the **Frame** breaking the silhouette, while confirming the **Aperture** remains functional.
2. **Material & Texture**: Tactile details (e.g., "Frosted glass with inner iridescence").
3. **Lighting & Atmosphere**: How light interacts (e.g., "Soft subsurface scattering").
4. **Style & Mood**: The artistic vibe (e.g., "Studio Ghibli background art").

## Examples

INPUT:
- Prompt: "A container for user avatar"
- Asset Type: container
- Style: "Ghibli anime clouds"

OUTPUT:
A whimsical cloud formation acting as a thin, delicate frame. The center is a generous open pill shape occupying most of the canvas for content, while the outer edges feature wispy, feathery cloud tendrils that break the silhouette without crowding the aperture. Subtle sunset pinks and golds tinge the cloud wisps. Soft volumetric lighting makes the edges appear translucent. Rendered in a hand-painted Studio Ghibli style with emphasis on negative space.

INPUT:
- Prompt: "A button"
- Asset Type: icon
- Style: "Organic forest"

OUTPUT:
A polished river stone wrapped in thin, ancient vines. The stone itself forms a large, usable button surface, with only delicate green tendrils and tiny leaves tracing the edge, extending sparingly into the negative space. The texture is subtly mossy. Dappled forest sunlight glints off occasional dew drops. High-fidelity macro photography style, prioritizing a clean center for text."""


class CreativeInterpreter:
    """
    Transforms generic prompts into imaginative, whimsical descriptions.
    
    Uses Kimi-K2 via HuggingFace router for creative expansion.
    Falls back gracefully to original prompt if LLM fails.
    """
    
    def __init__(self):
        """Initialize the interpreter with HuggingFace router client."""
        hf_token = os.environ.get("HF_TOKEN")
        
        if not hf_token:
            logger.warning(
                "HF_TOKEN not set. CreativeInterpreter will operate in passthrough mode."
            )
            self.client = None
        else:
            self.client = OpenAI(
                base_url=HF_ROUTER_BASE_URL,
                api_key=hf_token
            )
        
        self.model = MODEL_ID
    
    def interpret(
        self, 
        prompt: str, 
        asset_type: str, 
        style_context: str,
        render_size_hint: Optional[int] = None,
        tracer: Optional["Tracer"] = None
    ) -> str:
        """
        Interpret and creatively expand a user prompt.
        
        Args:
            prompt: Raw user prompt describing the asset
            asset_type: Category (container, icon, texture)
            style_context: Creative direction from user
            render_size_hint: Approximate target width in pixels (controls optical sizing)
            tracer: Optional tracer for observability
            
        Returns:
            Enhanced, imaginative prompt for Gemini generation.
            Falls back to original prompt if interpretation fails.
        """
        if self.client is None:
            raise RuntimeError("CreativeInterpreter not configured: HF_TOKEN environment variable is missing.")
        
        user_message = (
            f"=== SHAPE CONSTRAINT (APERTURE) ===\n"
            f"Target Shape: {prompt} (Asset Type: {asset_type})\n\n"
            f"=== CREATIVE DIRECTION (FRAME) ===\n"
            f"Style: {style_context}\n\n"
            f"=== CONTEXT ===\n"
            f"Render Hint: {render_size_hint if render_size_hint else 'Unknown (Assume Medium)'} px width."
        )
        
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ]
        
        # Record HF request for tracing
        if tracer:
            tracer.record("hf_request", {
                "model": self.model,
                "messages": messages,
                "max_tokens": 256,
                "temperature": 0.8
            })
        
        try:
            logger.info(f"Interpreting prompt via {self.model}...")
            
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=256,
                temperature=0.8,  # Encourage creativity
            )
            
            interpreted = completion.choices[0].message.content
            
            # Record HF response for tracing
            if tracer:
                tracer.record("hf_response", {
                    "status": "success",
                    "content": interpreted,
                    "usage": {
                        "prompt_tokens": getattr(completion.usage, "prompt_tokens", None),
                        "completion_tokens": getattr(completion.usage, "completion_tokens", None),
                        "total_tokens": getattr(completion.usage, "total_tokens", None)
                    } if completion.usage else None
                })
            
            if interpreted:
                interpreted = interpreted.strip()
                logger.info(f"Interpreted prompt: {interpreted[:100]}...")
                return interpreted
            else:
                raise RuntimeError("CreativeInterpreter returned empty response.")
                
        except Exception as e:
            # Record error for tracing
            if tracer:
                tracer.record("hf_response", {
                    "status": "error",
                    "error": str(e)
                })
            # Re-raise explicit exceptions so the MCP server can convert them to proper error codes.
            # Do NOT fall back to original prompt, as that poisons the data pipeline.
            logger.error(f"Interpretation failed: {e}")
            raise

