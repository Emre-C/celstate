"""
Creative Interpreter for Asset Generation.

Transforms user prompts into transparency-safe prompts for Gemini image generation.
Uses Kimi-K2 via HuggingFace router.

CRITICAL: This interpreter does NOT inject any aesthetic style.
It ONLY adds technical constraints for transparency extraction.
"""

import os
import logging
from typing import Optional, TYPE_CHECKING

from openai import OpenAI

if TYPE_CHECKING:
    from celstate.tracer import Tracer

logger = logging.getLogger(__name__)

# Model configuration
MODEL_ID = "moonshotai/Kimi-K2-Instruct-0905:groq"
HF_ROUTER_BASE_URL = "https://router.huggingface.co/v1"

# System prompt focused ONLY on transparency mechanics
SYSTEM_PROMPT = """You are a Transparency Preparation Assistant for AI image generation.

Your ONLY job is to add technical constraints that ensure the generated image can be cleanly extracted from its background using difference matting.

## WHAT YOU MUST DO

1. **Preserve user intent exactly**: Keep all style, aesthetic, and content words from the user's prompt verbatim.

2. **Add background purity constraints**: Append instructions that prevent fog, gradients, atmospheric effects, or anything that would contaminate the background.

3. **Add edge definition constraints**: Ensure the subject has self-contained materials and lighting. No edges that "fade into" or "blend with" the background.

4. **Add hollow region instructions** (for containers only): If the asset is a container/frame/bubble/card, explicitly state that the center must be filled with the same solid color as the background.

## WHAT YOU MUST NOT DO

- Do NOT change the user's artistic style or aesthetic
- Do NOT add creative embellishments (no "whimsical", "organic", "Ghibli", etc.)
- Do NOT add materials, textures, or decorative elements the user didn't request
- Do NOT "improve" the prompt with your own ideas
- Do NOT remove or rephrase the user's descriptive words

## OUTPUT FORMAT

Return a single paragraph that:
1. Starts with the user's original description (preserved verbatim or minimally rephrased for grammar)
2. Appends transparency constraints as a natural extension

## EXAMPLE

INPUT: "a glowing health potion bottle"
ASSET TYPE: icon

OUTPUT:
A glowing health potion bottle. The subject must have clearly defined edges with self-contained lighting and materials. All glow effects must be contained within or on the surface of the bottle, not radiating into the background. No fog, mist, atmospheric haze, or light rays. The background must remain completely empty and uniform. Sharp separation between subject and background at all boundaries.

INPUT: "a pill-shaped chat bubble frame"
ASSET TYPE: container

OUTPUT:
A pill-shaped chat bubble frame. The CENTER of the frame must be filled with the exact same solid color as the background, creating a hollow cutout effect. The decorative edges must not obscure the center region. All materials must have clearly defined edges with self-contained lighting. No fog, gradients, or atmospheric effects. No elements fading into or blending with the background."""


# Asset type inference rules
CONTAINER_KEYWORDS = {"frame", "container", "bubble", "card", "panel", "box", "border", "wrapper"}
ICON_KEYWORDS = {"button", "icon", "glyph", "symbol", "badge", "logo"}
TEXTURE_KEYWORDS = {"pattern", "texture", "tile", "seamless", "repeating"}
EFFECT_KEYWORDS = {"effect", "particle", "sparkle", "glow", "animation", "floating"}


def infer_asset_type(prompt: str) -> str:
    """Infer asset type from prompt keywords.
    
    Returns: 'container', 'icon', 'texture', 'effect', or 'icon' (default)
    """
    prompt_lower = prompt.lower()
    words = set(prompt_lower.split())
    
    # Check for keyword matches (order matters - container takes priority)
    if words & CONTAINER_KEYWORDS:
        return "container"
    if words & TEXTURE_KEYWORDS:
        return "texture"
    if words & EFFECT_KEYWORDS:
        return "effect"
    if words & ICON_KEYWORDS:
        return "icon"
    
    return "icon"  # Default


class CreativeInterpreter:
    """
    Transforms user prompts into transparency-safe prompts.
    
    Uses Kimi-K2 via HuggingFace router.
    Does NOT modify user's style or aesthetic intent.
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
        asset_type: Optional[str] = None,
        style_context: Optional[str] = None,
        render_size_hint: Optional[int] = None,
        tracer: Optional["Tracer"] = None,
    ) -> str:
        """
        Add transparency-safe constraints to user prompt.
        
        Does NOT modify user's style or aesthetic intent.
        
        Args:
            prompt: Raw user prompt describing the asset
            tracer: Optional tracer for observability
            
        Returns:
            Prompt with transparency constraints appended.
            
        Raises:
            RuntimeError: If HF_TOKEN is not set or interpretation fails.
        """
        if self.client is None:
            raise RuntimeError("CreativeInterpreter not configured: HF_TOKEN environment variable is missing.")
        
        # Infer asset type from prompt if not provided
        resolved_asset_type = asset_type or infer_asset_type(prompt)

        user_message_lines = [
            f"USER PROMPT: {prompt}",
            f"ASSET TYPE: {resolved_asset_type}",
        ]

        if render_size_hint is not None:
            user_message_lines.append(f"Render Hint: {render_size_hint} px width")

        if style_context:
            user_message_lines.append(f"STYLE CONTEXT: {style_context}")

        user_message_lines.append(
            "Add transparency constraints while preserving the user's exact style and intent."
        )

        user_message = "\n".join(user_message_lines)
        
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ]
        
        if tracer:
            tracer.record("hf_request", {
                "model": self.model,
                "messages": messages,
                "max_tokens": 256,
                "temperature": 0.3  # Lower temp for more faithful preservation
            })
        
        try:
            logger.info(f"Interpreting prompt via {self.model}...")
            
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=256,
                temperature=0.3,  # Lower temp = more faithful to user intent
            )
            
            interpreted = completion.choices[0].message.content
            
            if tracer:
                tracer.record("hf_response", {
                    "status": "success",
                    "content": interpreted,
                    "inferred_asset_type": resolved_asset_type,
                    "usage": {
                        "prompt_tokens": getattr(completion.usage, "prompt_tokens", None),
                        "completion_tokens": getattr(completion.usage, "completion_tokens", None),
                        "total_tokens": getattr(completion.usage, "total_tokens", None)
                    } if completion.usage else None
                })
            
            if interpreted:
                result = interpreted.strip()
                logger.info(f"Interpreted prompt: {result[:100]}...")
                return result
            else:
                raise RuntimeError("CreativeInterpreter returned empty response.")
                
        except Exception as e:
            if tracer:
                tracer.record("hf_response", {
                    "status": "error",
                    "error": str(e)
                })
            logger.error(f"Interpretation failed: {e}")
            raise
